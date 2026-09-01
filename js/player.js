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

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';

    this.course = null;
    this.tracks = [];
    this.index = -1;
    this.objectUrl = null;
    this.artworkUrl = null;
    this.skipSeconds = 10;
    this.autoAdvance = true;
    this.listeners = new Set();
    this._saveTimer = 0;
    this._markedPlayed = false;

    this.audio.addEventListener('timeupdate', () => {
      this._maybeMarkPlayed();
      this._throttledSave();
      this._emit();
    });
    this.audio.addEventListener('loadedmetadata', () => {
      const track = this.currentTrack;
      if (track && Number.isFinite(this.audio.duration)) {
        setTrackDuration(track.id, this.audio.duration).catch(() => {});
        track.duration = track.duration || this.audio.duration;
      }
      this._emit();
    });
    this.audio.addEventListener('play', () => { this._updateMediaSession(); this._emit(); });
    this.audio.addEventListener('pause', () => { this._flushProgress(); this._emit(); });
    this.audio.addEventListener('ratechange', () => this._emit());
    this.audio.addEventListener('ended', () => this._onEnded());
    this.audio.addEventListener('error', () => this._emit());

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
    return {
      course: this.course,
      track: this.currentTrack,
      index: this.index,
      total: this.tracks.length,
      playing: !this.audio.paused && !this.audio.ended && this.audio.readyState > 0,
      currentTime: this.audio.currentTime || 0,
      duration: Number.isFinite(this.audio.duration) ? this.audio.duration : (this.currentTrack?.duration || 0),
      rate: this.audio.playbackRate,
      hasTrack: this.index >= 0,
    };
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

    await this._flushProgress();

    const blob = await getTrackBlob(track.id);
    if (!blob) throw new Error(`Audio data missing for "${track.title}".`);

    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = URL.createObjectURL(blob);
    this.index = index;
    this._markedPlayed = false;

    this.audio.src = this.objectUrl;
    this.audio.load();

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
    this._emit();
  }

  /* ---------------------------------------------------------------- */
  /* Transport                                                         */
  /* ---------------------------------------------------------------- */

  async play() {
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
    this.audio.pause();
    this._emit();
  }

  toggle() {
    if (this.audio.paused) this.play();
    else this.pause();
  }

  /** Stops playback and rewinds to the beginning of the current track. */
  stop() {
    this.audio.pause();
    try { this.audio.currentTime = 0; } catch { /* ignore */ }
    const track = this.currentTrack;
    if (track) saveProgress(track.id, track.courseId, { position: 0 }).catch(() => {});
    this._emit();
  }

  skip(seconds) {
    if (this.index < 0) return;
    const duration = Number.isFinite(this.audio.duration) ? this.audio.duration : Infinity;
    const target = Math.min(Math.max(0, this.audio.currentTime + seconds), duration - 0.25);
    try { this.audio.currentTime = Math.max(0, target); } catch { /* ignore */ }
    this._emit();
  }

  back() { this.skip(-this.skipSeconds); }
  forward() { this.skip(this.skipSeconds); }

  seekTo(seconds) {
    if (this.index < 0) return;
    try { this.audio.currentTime = seconds; } catch { /* ignore */ }
    this._emit();
  }

  async previous() {
    // Mirrors the usual convention: restart the track unless we are near its start.
    if (this.audio.currentTime > 3) {
      this.seekTo(0);
      return;
    }
    if (this.index > 0) await this.load(this.index - 1, { autoplay: true, resume: false });
    else this.seekTo(0);
  }

  async next() {
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

  setSkipSeconds(seconds) {
    this.skipSeconds = seconds;
    this._emit();
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
