/**
 * Audio engine.
 *
 * Wraps a single <audio> element and exposes the transport controls the UI
 * needs: play, pause, stop, skip backward/forward, previous/next track,
 * seeking, and playback speed. It also mirrors state to the OS lock screen
 * through the Media Session API.
 */

import {
  getTrackBlob,
  saveProgress,
  setTrackDuration,
  getProgress,
} from './db.js';

const PLAYED_THRESHOLD = 0.94; // 94% listened counts as "played"
const SLEEP_FADE_MS = 6000;    // gentle fade before the sleep timer stops play

/**
 * Builds a silent WAV of the requested length.
 *
 * The break between repeats is timed by *playing* this silence rather than by
 * a JavaScript timer. Phones throttle timers heavily once the screen goes off,
 * which would stretch a five second break into a minute or more, but a page
 * that is playing audio keeps running normally. Playing silence also holds on
 * to the audio focus, so the lock screen controls and Bluetooth connection
 * survive the pause.
 */
function silentWav(seconds) {
  const sampleRate = 8000;
  const samples = Math.max(1, Math.round(sampleRate * seconds));
  const buffer = new ArrayBuffer(44 + samples);
  const view = new DataView(buffer);
  const text = (offset, value) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);        // PCM header size
  view.setUint16(20, 1, true);         // PCM
  view.setUint16(22, 1, true);         // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true); // byte rate
  view.setUint16(32, 1, true);          // block align
  view.setUint16(34, 8, true);          // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  // 8-bit PCM silence is 128, and the buffer is already zero-filled, so fill it.
  new Uint8Array(buffer, 44).fill(128);
  return new Blob([buffer], { type: 'audio/wav' });
}

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';

    // Tells the operating system this is long-form playback that should carry
    // on when the screen is locked, rather than a transient sound effect.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch { /* not supported everywhere */ }

    this.course = null;
    this.tracks = [];
    this.index = -1;
    this.objectUrl = null;
    this.artworkUrl = null;
    this.backSeconds = 10;
    this.forwardSeconds = 10;
    this.autoAdvance = true;
    // How many times the current lesson should play in a row. 1 means play it
    // once; Infinity repeats it until stopped.
    this.repeatTarget = 1;
    this.playsDone = 0;
    // Silent break between repeats, in seconds.
    this.breakSeconds = 0;
    // Sleep timer: stops playback at this moment, 0 when switched off.
    this.sleepEndsAt = 0;
    this.sleepMinutes = 0;
    this._sleepFadeStart = 0;
    this.listeners = new Set();
    this._saveTimer = 0;
    this._markedPlayed = false;

    this.breakAudio = new Audio();
    this.breakAudio.preload = 'auto';
    this._breakUrl = null;
    this._onBreakDone = null;
    this.breakAudio.addEventListener('timeupdate', () => { this._tickSleep(); this._emit(); });
    this.breakAudio.addEventListener('ended', () => {
      const done = this._onBreakDone;
      this._clearBreak();
      if (done) done();
    });
    this.breakAudio.addEventListener('error', () => {
      const done = this._onBreakDone;
      this._clearBreak();
      if (done) done();
    });

    this.audio.addEventListener('timeupdate', () => {
      this._maybeMarkPlayed();
      this._throttledSave();
      this._updatePositionState();
      this._tickSleep();
      this._emit();
    });
    this.audio.addEventListener('loadedmetadata', () => {
      const track = this.currentTrack;
      if (track && Number.isFinite(this.audio.duration)) {
        setTrackDuration(track.id, this.audio.duration).catch(() => {});
        track.duration = track.duration || this.audio.duration;
      }
      this._updatePositionState();
      this._emit();
    });
    this.audio.addEventListener('play', () => {
      this._updateMediaSession();
      this._setPlaybackState('playing');
      this._emit();
    });
    this.audio.addEventListener('pause', () => {
      this._flushProgress();
      // A break is still "playing" as far as the listener is concerned, so the
      // lock screen should not flip to paused between repeats.
      if (!this._onBreakDone) this._setPlaybackState('paused');
      this._emit();
    });
    this.audio.addEventListener('ratechange', () => { this._updatePositionState(); this._emit(); });
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('error', () => {
      const track = this.currentTrack;
      const snapshot = this.snapshot();
      for (const listener of this.listeners) {
        listener(snapshot, {
          loadError: track
            ? `"${track.title}" could not be played. Try removing it and adding the file again.`
            : 'That audio could not be played.',
        });
      }
    });

    this._installMediaSession();
  }

  /* ---------------------------------------------------------------- */

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  _emit() {
    for (const listener of this.listeners) listener(this.snapshot());
  }

  snapshot() {
    const breaking = this.isBreaking;
    return {
      course: this.course,
      track: this.currentTrack,
      index: this.index,
      total: this.tracks.length,
      playing: breaking || (!this.audio.paused && !this.audio.ended && this.audio.readyState > 0),
      currentTime: this.audio.currentTime || 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : (this.currentTrack?.duration || 0),
      rate: this.audio.playbackRate,
      hasTrack: this.index >= 0,
      repeatTarget: this.repeatTarget,
      // 1-based number of the pass currently playing, for "Play 2 of 3".
      repeatPass: Math.min(this.playsDone + 1, this.repeatTarget),
      breaking,
      breakRemaining: breaking
        ? Math.max(0, Math.ceil((this.breakAudio.duration || this.breakSeconds) - (this.breakAudio.currentTime || 0)))
        : 0,
      sleepMinutes: this.sleepMinutes,
      sleepRemainingMs: this.sleepEndsAt ? Math.max(0, this.sleepEndsAt - Date.now()) : 0,
    };
  }

  /** True while the silent break between repeats is running. */
  get isBreaking() {
    return Boolean(this._onBreakDone) && !this.breakAudio.paused;
  }

  /**
   * Waits for the configured break, then runs `next`. The wait is driven by
   * playing silence so it stays accurate with the screen off.
   */
  async _runBreak(next) {
    if (!(this.breakSeconds > 0)) { next(); return; }
    this._clearBreak();
    // Remember what the break belongs to, so a lesson change during the break
    // cannot resume the wrong audio.
    const forTrackId = this.currentTrack?.id;
    this._onBreakDone = () => {
      if (this.currentTrack?.id !== forTrackId) { this._emit(); return; }
      next();
    };
    this._breakUrl = URL.createObjectURL(silentWav(this.breakSeconds));
    this.breakAudio.src = this._breakUrl;
    this.breakAudio.currentTime = 0;
    try {
      await this.breakAudio.play();
      // The listener is still in a session, so keep the lock screen showing
      // "playing" while the silence runs.
      this._setPlaybackState('playing');
      this._emit();
    } catch {
      // If the silence cannot play, fall straight through to the next pass.
      this._clearBreak();
      next();
    }
  }

  /** Stops any running break. Returns the pending action, if there was one. */
  _clearBreak() {
    const pending = this._onBreakDone;
    this._onBreakDone = null;
    try { this.breakAudio.pause(); } catch { /* ignore */ }
    if (this._breakUrl) {
      URL.revokeObjectURL(this._breakUrl);
      this._breakUrl = null;
    }
    return pending;
  }

  /** Ends the break immediately and carries on with what it was waiting for. */
  skipBreak() {
    const pending = this._clearBreak();
    if (pending) pending();
    else this._emit();
  }

  get currentTrack() {
    return this.index >= 0 ? this.tracks[this.index] || null : null;
  }

  /* ---------------------------------------------------------------- */
  /* Loading                                                           */
  /* ---------------------------------------------------------------- */

  setQueue(course, tracks) {
    this.course = course;
    this.tracks = tracks;
    if (this.currentTrack && !tracks.some((t) => t.id === this.currentTrack.id)) {
      this.unload();
    } else if (this.currentTrack) {
      this.index = tracks.findIndex((t) => t.id === this.currentTrack.id);
    }
    this._emit();
  }

  /**
   * Loads a track by index. `resume` restores the saved position recorded on
   * this device; `autoplay` starts playback once the media is ready.
   */
  async load(index, { autoplay = true, resume = true, startAt = null } = {}) {
    if (index < 0 || index >= this.tracks.length) return;
    const track = this.tracks[index];

    this._clearBreak();
    await this._flushProgress();

    const blob = await getTrackBlob(track.id);
    if (!blob) throw new Error(`Audio data missing for "${track.title}".`);

    // Point the element at the new audio *before* releasing the old blob URL.
    // Revoking a URL while the element is still reading it makes the element
    // fail to load, which left the next lesson silent when a listener switched
    // lessons during playback.
    const previousUrl = this.objectUrl;
    this.objectUrl = URL.createObjectURL(blob);
    this.index = index;
    this._markedPlayed = false;
    this.playsDone = 0;

    this.audio.src = this.objectUrl;
    this.audio.load();
    if (previousUrl) URL.revokeObjectURL(previousUrl);

    let position = startAt ?? 0;
    if (startAt === null && resume) {
      const saved = await getProgress(track.id);
      if (saved && saved.position > 3 && !saved.played) position = saved.position;
    }

    if (position > 0) {
      await new Promise((resolve) => {
        const seek = () => {
          try { this.audio.currentTime = position; } catch { /* ignore */ }
          resolve();
        };
        if (this.audio.readyState >= 1) seek();
        else this.audio.addEventListener('loadedmetadata', seek, { once: true });
      });
    }

    this._updateMediaSession();
    if (autoplay) await this.play();
    this._emit();
  }

  unload() {
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.index = -1;
    this._setPlaybackState('none');
    this._emit();
  }

  /* ---------------------------------------------------------------- */
  /* Transport                                                         */
  /* ---------------------------------------------------------------- */

  async play() {
    if (this.isBreaking) { this.skipBreak(); return; }
    if (this.index < 0 && this.tracks.length) return this.load(0);
    try {
      await this.audio.play();
    } catch (error) {
      // Autoplay restrictions: surfaced to the UI as "not playing".
      console.warn('Playback was blocked:', error);
    }
    this._emit();
  }

  pause() {
    this._clearBreak();
    this.audio.pause();
    this._emit();
  }

  toggle() {
    if (this.isBreaking) { this.skipBreak(); return; }
    if (this.audio.paused) this.play();
    else this.pause();
  }

  /** Stops playback, rewinds, and starts the repeat cycle again. */
  stop() {
    this._clearBreak();
    this.audio.pause();
    try { this.audio.currentTime = 0; } catch { /* ignore */ }
    this.playsDone = 0;
    this._markedPlayed = false;
    const track = this.currentTrack;
    if (track) saveProgress(track.id, track.courseId, { position: 0 }).catch(() => {});
    this._emit();
  }

  skip(seconds) {
    if (this.index < 0) return;
    if (this.isBreaking) this.skipBreak();
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : Infinity;
    const target = Math.min(Math.max(0, this.audio.currentTime + seconds), duration - 0.25);
    try { this.audio.currentTime = Math.max(0, target); } catch { /* ignore */ }
    this._emit();
  }

  back() { this.skip(-this.backSeconds); }
  forward() { this.skip(this.forwardSeconds); }

  seekTo(seconds) {
    if (this.index < 0) return;
    try { this.audio.currentTime = seconds; } catch { /* ignore */ }
    this._emit();
  }

  async previous() {
    this._clearBreak();
    // Mirrors the usual convention: restart the track unless we are near its start.
    if (this.audio.currentTime > 3) {
      this.seekTo(0);
      return;
    }
    if (this.index > 0) await this.load(this.index - 1, { autoplay: true, resume: false });
    else this.seekTo(0);
  }

  async next() {
    this._clearBreak();
    if (this.index < this.tracks.length - 1) {
      await this.load(this.index + 1, { autoplay: true, resume: false });
    } else {
      this.pause();
    }
  }

  setRate(rate) {
    this.audio.playbackRate = rate;
    this._emit();
  }

  /**
   * Sets how many times in a row the current lesson plays.
   * 1 plays it once, 3 plays it three times, Infinity repeats until stopped.
   */
  setRepeat(target) {
    this.repeatTarget = target > 0 ? target : 1;
    if (this.playsDone >= this.repeatTarget) this.playsDone = 0;
    this._emit();
  }

  setBackSeconds(seconds) {
    this.backSeconds = seconds;
    this._emit();
  }

  setForwardSeconds(seconds) {
    this.forwardSeconds = seconds;
    this._emit();
  }

  /** Length of the silent break between repeats, in seconds (0 disables it). */
  setBreakSeconds(seconds) {
    this.breakSeconds = Math.max(0, seconds || 0);
    if (!this.breakSeconds && this.isBreaking) this.skipBreak();
    this._emit();
  }

  /**
   * Stops playback after the given number of minutes, for listening in bed.
   * Pass 0 to switch the timer off.
   */
  setSleepMinutes(minutes) {
    this.sleepMinutes = Math.max(0, minutes || 0);
    this.sleepEndsAt = this.sleepMinutes ? Date.now() + this.sleepMinutes * 60000 : 0;
    this._sleepFadeStart = 0;
    this.audio.volume = 1;
    this._emit();
  }

  /**
   * Checked from media `timeupdate` events rather than a timer.
   *
   * Phones throttle timers once the screen is off, but these events keep
   * arriving while audio plays, so the timer stays accurate in the dark. The
   * remaining time is measured against the wall clock, so even a long gap
   * between events cannot make it overshoot.
   */
  _tickSleep() {
    if (!this.sleepEndsAt) return;
    const now = Date.now();

    if (!this._sleepFadeStart) {
      if (now < this.sleepEndsAt) return;
      this._sleepFadeStart = now;
    }

    // Fade out over a few seconds so it does not cut off abruptly at night.
    const elapsed = now - this._sleepFadeStart;
    const remaining = 1 - elapsed / SLEEP_FADE_MS;
    if (remaining > 0) {
      try { this.audio.volume = Math.max(0, Math.min(1, remaining)); } catch { /* ignore */ }
      return;
    }

    this._clearBreak();
    this.audio.pause();
    try { this.audio.volume = 1; } catch { /* ignore */ }
    this.sleepEndsAt = 0;
    this.sleepMinutes = 0;
    this._sleepFadeStart = 0;
    this._setPlaybackState('paused');
    for (const listener of this.listeners) listener(this.snapshot(), { sleepFired: true });
  }

  /* ---------------------------------------------------------------- */
  /* Progress bookkeeping                                              */
  /* ---------------------------------------------------------------- */

  _throttledSave() {
    const now = Date.now();
    if (now - this._saveTimer < 4000) return;
    this._saveTimer = now;
    this._flushProgress();
  }

  async _flushProgress() {
    const track = this.currentTrack;
    if (!track) return;
    const position = this.audio.currentTime || 0;
    if (position <= 0) return;
    try {
      await saveProgress(track.id, track.courseId, { position, lastPlayedAt: Date.now() });
    } catch { /* ignore */ }
  }

  _maybeMarkPlayed() {
    const track = this.currentTrack;
    if (!track || this._markedPlayed) return;
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    if (this.audio.currentTime / duration < PLAYED_THRESHOLD) return;
    this._markedPlayed = true;
    this._recordPlayed(track);
  }

  async _recordPlayed(track) {
    try {
      await saveProgress(track.id, track.courseId, (existing) => ({
        played: true,
        playCount: (existing.playCount || 0) + 1,
        lastPlayedAt: Date.now(),
      }));
      for (const listener of this.listeners) listener(this.snapshot(), { playedChanged: track.id });
    } catch { /* ignore */ }
  }

  async _onEnded() {
    const track = this.currentTrack;
    if (track && !this._markedPlayed) {
      this._markedPlayed = true;
      await this._recordPlayed(track);
    }
    if (track) await saveProgress(track.id, track.courseId, { position: 0 }).catch(() => {});

    this.playsDone += 1;

    // Repeating the lesson takes precedence over moving to the next one, so a
    // study session can drill the same lesson the chosen number of times.
    if (track && this.playsDone < this.repeatTarget) {
      this._markedPlayed = false;
      try { this.audio.currentTime = 0; } catch { /* ignore */ }
      this._runBreak(() => {
        this.audio.play().catch(() => {});
        this._emit();
      });
      this._emit();
      return;
    }

    this.playsDone = 0;
    if (this.autoAdvance && this.index < this.tracks.length - 1) {
      await this.load(this.index + 1, { autoplay: true, resume: false });
    } else {
      this._emit();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Lock screen / headphone controls                                  */
  /* ---------------------------------------------------------------- */

  _installMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const handlers = {
      play: () => this.play(),
      pause: () => this.pause(),
      stop: () => this.stop(),
      seekbackward: () => this.back(),
      seekforward: () => this.forward(),
      previoustrack: () => this.previous(),
      nexttrack: () => this.next(),
      seekto: (details) => { if (details.seekTime != null) this.seekTo(details.seekTime); },
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported */ }
    }
  }

  /** Cover picture shown on the lock screen, or null for the default icon. */
  setArtwork(url) {
    this.artworkUrl = url || null;
    this._updateMediaSession();
  }

  /** Keeps the notification's play/pause button in step with the audio. */
  _setPlaybackState(playbackState) {
    if (!('mediaSession' in navigator)) return;
    try { navigator.mediaSession.playbackState = playbackState; } catch { /* ignore */ }
  }

  /**
   * Publishes the current position so the notification and lock screen can show
   * a progress bar and let the listener scrub without opening the app.
   */
  _updatePositionState() {
    if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
    const duration = this.audio.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(Math.max(0, this.audio.currentTime || 0), duration),
      });
    } catch { /* ignore */ }
  }

  _updateMediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const track = this.currentTrack;
    if (!track) return;
    const artwork = this.artworkUrl
      ? [{ src: this.artworkUrl, sizes: '512x512', type: 'image/*' }]
      : [
        { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      ];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track.title,
        artist: this.course?.title || 'Language course',
        album: this.course?.subtitle || '',
        artwork,
      });
    } catch { /* ignore */ }
  }
}
