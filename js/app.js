/**
 * Application controller: screens, rendering and event wiring.
 */

import {
  listCourses, getCourse, createCourse, updateCourse, deleteCourse,
  listTracks, deleteTrack, getTrackBlob,
  getProgressForCourse, getProgress, saveProgress, resetCourseProgress, countsForCourse,
  getDevice, setDeviceName, getSetting, setSetting,
  requestPersistentStorage, storageEstimate, exportProgressReport,
  setCourseCover, getCourseCover, deleteCourseCover,
} from './db.js';
import { Player } from './player.js';
import { importFiles, probeDurations } from './import.js';
import { prepareCover } from './image.js';
import { t, setLanguage, getLanguage, detectLanguage, translateDocument } from './i18n.js';

const $ = (selector) => document.querySelector(selector);

const player = new Player();

/** Values the "Reset" button restores. */
const DEFAULTS = {
  repeat: '1',
  breakSeconds: 0,
  backSeconds: 10,
  forwardSeconds: 10,
  playbackRate: 1,
  autoAdvance: false,
  sleepMinutes: 0,
};

const state = {
  device: { id: '', name: '' },
  courses: [],
  course: null,
  tracks: [],
  progress: new Map(),
  screen: 'welcome',
  seeking: false,
  // Cover picture chosen in the dialog but not yet saved:
  // a Blob to store, 'remove' to clear, or null to leave unchanged.
  pendingCover: null,
};

/* ====================================================================== */
/* Cover pictures                                                          */
/* ====================================================================== */

/** Object URLs for stored covers, so each image is only decoded once. */
const coverUrls = new Map();

async function coverUrl(course) {
  if (!course?.hasCover) return null;
  const cacheKey = `${course.id}:${course.coverUpdatedAt || 0}`;
  const cached = coverUrls.get(course.id);
  if (cached && cached.key === cacheKey) return cached.url;

  const blob = await getCourseCover(course.id);
  if (!blob) return null;
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(blob);
  coverUrls.set(course.id, { key: cacheKey, url });
  return url;
}

function forgetCover(courseId) {
  const cached = coverUrls.get(courseId);
  if (cached) {
    URL.revokeObjectURL(cached.url);
    coverUrls.delete(courseId);
  }
}

/** Fills an element with the cover image, or falls back to the initial letter. */
function paintCover(element, url, letter) {
  element.querySelector('img')?.remove();
  const span = element.querySelector('span');
  if (span) span.textContent = letter;
  element.classList.toggle('has-cover', Boolean(url));
  if (!url) return;
  const image = document.createElement('img');
  image.src = url;
  image.alt = '';
  element.prepend(image);
}

/* ====================================================================== */
/* Boot                                                                    */
/* ====================================================================== */

async function init() {
  setLanguage(await getSetting('language', detectLanguage()));
  translateDocument();

  state.device = await getDevice();
  renderDeviceLine();

  player.backSeconds = Number(await getSetting('backSeconds', await getSetting('skipSeconds', DEFAULTS.backSeconds)));
  player.forwardSeconds = Number(await getSetting('forwardSeconds', await getSetting('skipSeconds', DEFAULTS.forwardSeconds)));
  player.autoAdvance = (await getSetting('autoAdvance', DEFAULTS.autoAdvance)) === true;
  const rate = Number(await getSetting('playbackRate', DEFAULTS.playbackRate));
  player.setRate(rate);
  const repeat = await getSetting('repeat', DEFAULTS.repeat);
  player.setRepeat(parseRepeat(repeat));
  player.setBreakSeconds(Number(await getSetting('breakSeconds', DEFAULTS.breakSeconds)));
  syncControls();
  wireEvents();
  applyPlatformCapabilities();
  player.onChange(renderPlayerState);

  await renderLibrary();
  await refreshStorageLine();
  await applyOrientation(await getSetting('orientation', 'auto'));

  const lastCourseId = await getSetting('lastCourseId');
  if (lastCourseId && state.courses.some((course) => course.id === lastCourseId)) {
    await openCourse(lastCourseId, { navigate: false });
  }

  registerServiceWorker();
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return; // service workers need http(s)

  // When an updated worker takes over, the page may still be running the
  // previous version's code. Reloading once puts the markup and the scripts
  // back in step. The flag stops this from looping.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    window.location.reload();
  });

  navigator.serviceWorker.register('sw.js').catch((error) => {
    console.warn('Offline cache unavailable:', error);
  });
}

/**
 * Sets a form control's value if that control exists.
 *
 * During an update the browser can briefly pair new markup with older scripts.
 * Skipping absent controls keeps the app usable through that moment instead of
 * failing to start.
 */
function setControl(selector, value, property = 'value') {
  const element = $(selector);
  if (element) element[property] = value;
}

/** Attaches a listener when the element is present, for the same reason. */
function on(selector, type, handler) {
  const element = $(selector);
  if (element) element.addEventListener(type, handler);
}

/** Mirrors the player's current settings onto the controls. */
function syncControls() {
  const repeat = player.repeatTarget === Infinity ? 'inf' : String(player.repeatTarget);
  setControl('#repeat', repeat);
  setControl('#break-seconds', String(player.breakSeconds));
  setControl('#rate', String(player.audio.playbackRate));
  setControl('#back-seconds', String(player.backSeconds));
  setControl('#forward-seconds', String(player.forwardSeconds));
  setControl('#sleep-minutes', String(player.sleepMinutes || 0));
  setControl('#auto-advance', player.autoAdvance, 'checked');
  updateSkipLabels();
}

/** Puts every playback control back to its default. */
async function resetControls() {
  player.setRepeat(parseRepeat(DEFAULTS.repeat));
  player.setBreakSeconds(DEFAULTS.breakSeconds);
  player.setBackSeconds(DEFAULTS.backSeconds);
  player.setForwardSeconds(DEFAULTS.forwardSeconds);
  player.setRate(DEFAULTS.playbackRate);
  player.setSleepMinutes(DEFAULTS.sleepMinutes);
  player.autoAdvance = DEFAULTS.autoAdvance;

  await Promise.all([
    setSetting('repeat', DEFAULTS.repeat),
    setSetting('breakSeconds', DEFAULTS.breakSeconds),
    setSetting('backSeconds', DEFAULTS.backSeconds),
    setSetting('forwardSeconds', DEFAULTS.forwardSeconds),
    setSetting('playbackRate', DEFAULTS.playbackRate),
    setSetting('autoAdvance', DEFAULTS.autoAdvance),
  ]);

  syncControls();
  toast(t('toast.controlsReset'));
}

/** The device line mixes text and a highlighted name, so it is built here. */
function renderDeviceLine() {
  const line = $('#device-line');
  if (!line) return;
  line.innerHTML = t('welcome.deviceLine', { device: escapeHtml(state.device.name) });
}

/** Re-renders everything that holds translated text. */
async function applyLanguage(code) {
  setLanguage(code);
  await setSetting('language', code);
  translateDocument();
  renderDeviceLine();
  markSegments('#language-toggle', 'lang', code);
  updateSkipLabels();
  updateCoverPreview();
  await renderLibrary();
  await refreshStorageLine();
  if (state.course) {
    renderTracks();
    renderCourseSummary();
  }
  renderPlayerState(player.snapshot());
}

function markSegments(container, dataKey, value) {
  for (const button of document.querySelectorAll(`${container} .segment`)) {
    button.classList.toggle('is-active', button.dataset[dataKey] === value);
  }
}

/**
 * Applies the chosen screen orientation.
 *
 * Locking is only permitted for an installed app, so in a browser tab the
 * request is refused. The preference is still remembered and takes effect once
 * the app is installed; the layout itself adapts to either orientation
 * regardless of whether locking is available.
 */
async function applyOrientation(mode, { announce = false } = {}) {
  await setSetting('orientation', mode);
  markSegments('#orientation-toggle', 'orientation', mode);

  const orientation = screen.orientation;
  if (!orientation) {
    if (announce) toast(t('toast.orientationNeedsApp'));
    return;
  }

  if (mode === 'auto') {
    try { orientation.unlock(); } catch { /* nothing to unlock */ }
    if (announce) toast(t('toast.orientationAuto'));
    return;
  }

  try {
    await orientation.lock(mode === 'portrait' ? 'portrait' : 'landscape');
    if (announce) toast(t('toast.orientationLocked', { mode: t(`orientation.${mode}`) }));
  } catch {
    if (announce) toast(t('toast.orientationNeedsApp'));
  }
}

/** The repeat menu stores "inf" for endless looping, otherwise a count. */
function parseRepeat(value) {
  return value === 'inf' ? Infinity : Math.max(1, Number(value) || 1);
}

/**
 * Hides controls the current platform cannot honour. iOS and iPadOS have no
 * folder picker, so only the multi-file picker is offered there.
 */
function applyPlatformCapabilities() {
  const ua = navigator.userAgent;
  const isIos = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const supportsFolders = 'webkitdirectory' in document.createElement('input') && !isIos;
  $('#btn-add-folder').classList.toggle('hidden', !supportsFolders);
}

/* ====================================================================== */
/* Navigation                                                              */
/* ====================================================================== */

function navigate(screen) {
  state.screen = screen;
  for (const section of document.querySelectorAll('.screen')) {
    section.classList.toggle('is-active', section.id === `screen-${screen}`);
  }
  window.scrollTo(0, 0);
  updateMiniPlayer();
}

/* ====================================================================== */
/* Welcome screen                                                          */
/* ====================================================================== */

async function renderLibrary() {
  state.courses = await listCourses();
  const grid = $('#course-grid');
  grid.innerHTML = '';

  $('#empty-library').classList.toggle('hidden', state.courses.length > 0);

  for (const course of state.courses) {
    const counts = await countsForCourse(course.id);
    const percent = counts.total ? Math.round((counts.played / counts.total) * 100) : 0;
    const url = await coverUrl(course);

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'course-card';
    card.classList.toggle('has-cover', Boolean(url));
    card.style.setProperty('--card-accent', course.accent);
    card.innerHTML = `
      <div class="card-body">
        <div>
          <span class="badge">${escapeHtml(initials(course.title))}</span>
          <h3></h3>
          <p></p>
        </div>
        <div>
          <div class="progress-bar"><span style="width:${percent}%"></span></div>
          <p style="margin-top:8px">${escapeHtml(t('course.playedCount', { played: counts.played, total: counts.total }))}</p>
        </div>
      </div>`;
    if (url) {
      const image = document.createElement('img');
      image.className = 'cover-image';
      image.src = url;
      image.alt = '';
      card.prepend(image);
    }
    card.querySelector('h3').textContent = course.title;
    card.querySelector('p').textContent = course.subtitle || formatDuration(counts.totalSeconds) ||
      t('course.lessons', { count: counts.total });
    card.addEventListener('click', () => openCourse(course.id));
    grid.appendChild(card);
  }
}

async function refreshStorageLine() {
  const estimate = await storageEstimate();
  const line = $('#storage-line');
  if (!estimate?.usage) {
    line.textContent = t('welcome.storagePlain');
    return;
  }
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  line.textContent = t('welcome.storage', {
    used: formatBytes(estimate.usage),
    quota: estimate.quota ? formatBytes(estimate.quota) : '—',
  }) + (persisted ? t('welcome.storageProtected') : '');
}

/* ====================================================================== */
/* Course screen                                                           */
/* ====================================================================== */

async function openCourse(courseId, { navigate: shouldNavigate = true } = {}) {
  const course = await getCourse(courseId);
  if (!course) return;
  state.course = course;
  await setSetting('lastCourseId', courseId);

  document.documentElement.style.setProperty('--card-accent', course.accent);
  $('#course-title').textContent = course.title;
  $('#course-subtitle').textContent = course.subtitle || '';
  $('#player-course').textContent = course.title;

  await paintCourseArtwork(course);

  await refreshTracks();
  if (shouldNavigate) navigate('course');
}

/** Applies the course cover to the course header and the player artwork. */
async function paintCourseArtwork(course) {
  const url = await coverUrl(course);
  const letter = initials(course.title);
  paintCover($('#course-head-cover'), url, letter);
  paintCover($('#player-artwork'), url, letter);
  player.setArtwork(url);
}

async function refreshTracks() {
  if (!state.course) return;
  state.tracks = await listTracks(state.course.id);
  state.progress = await getProgressForCourse(state.course.id);
  player.setQueue(state.course, state.tracks);
  renderTracks();
  renderCourseSummary();
}

function renderCourseSummary() {
  const total = state.tracks.length;
  let played = 0;
  let seconds = 0;
  for (const track of state.tracks) {
    if (state.progress.get(track.id)?.played) played += 1;
    seconds += track.duration || 0;
  }
  const percent = total ? Math.round((played / total) * 100) : 0;
  $('#course-progress-fill').style.width = `${percent}%`;
  $('#course-progress-text').textContent = total
    ? t('course.progress', { played, total, device: state.device.name }) +
      (seconds ? t('course.progressTotal', { duration: formatDuration(seconds) }) : '')
    : t('course.noAudio');
  $('#empty-course').classList.toggle('hidden', total > 0);
}

function renderTracks() {
  const list = $('#track-list');
  list.innerHTML = '';
  const currentId = player.currentTrack?.id;

  state.tracks.forEach((track, index) => {
    const progress = state.progress.get(track.id);
    const row = document.createElement('li');
    row.className = 'track-row';
    row.classList.toggle('is-played', Boolean(progress?.played));
    row.classList.toggle('is-current', track.id === currentId);

    const number = document.createElement('span');
    number.className = 'track-index';
    number.textContent = String(index + 1);

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'track-main';
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = track.title;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = trackMeta(track, progress);
    main.append(name, meta);
    main.addEventListener('click', () => playTrack(index));

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'played-toggle';
    toggle.title = progress?.played ? t('aria.markNotPlayed') : t('aria.markPlayed');
    toggle.setAttribute('aria-label', toggle.title);
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    toggle.addEventListener('click', () => togglePlayed(track));

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'track-delete';
    remove.setAttribute('aria-label', t('aria.removeTrack', { title: track.title }));
    remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12l-1 13H7L6 7Zm3-3h6l1 2H8l1-2Z"/></svg>';
    remove.addEventListener('click', () => removeTrack(track));

    row.append(number, main, toggle, remove);
    list.appendChild(row);
  });
}

function trackMeta(track, progress) {
  const bits = [];
  if (track.duration) bits.push(formatTime(track.duration));
  else bits.push(formatBytes(track.size));
  if (progress?.played) {
    bits.push(progress.playCount > 1
      ? t('meta.playedTimes', { count: progress.playCount })
      : t('meta.played'));
  } else if (progress?.position > 5) {
    bits.push(t('meta.resumeAt', { time: formatTime(progress.position) }));
  }
  if (progress?.lastPlayedAt) bits.push(relativeDate(progress.lastPlayedAt));
  return bits.join(' · ');
}

async function togglePlayed(track) {
  const played = !state.progress.get(track.id)?.played;
  const updated = await saveProgress(track.id, track.courseId, (existing) => ({
    played,
    position: played ? 0 : existing.position,
    playCount: played ? Math.max(1, existing.playCount || 0) : existing.playCount,
    lastPlayedAt: played ? Date.now() : existing.lastPlayedAt,
  }));
  state.progress.set(track.id, updated);
  renderTracks();
  renderCourseSummary();
}

async function removeTrack(track) {
  if (!confirm(t('confirm.removeTrack', { title: track.title }))) return;
  if (player.currentTrack?.id === track.id) player.unload();
  await deleteTrack(track.id);
  await refreshTracks();
  await refreshStorageLine();
  toast(t('toast.trackRemoved'));
}

/* ====================================================================== */
/* Playback                                                                */
/* ====================================================================== */

async function playTrack(index) {
  try {
    await player.load(index, { autoplay: true, resume: true });
    navigate('player');
  } catch (error) {
    toast(error.message || t('toast.importFailed'));
  }
}

async function continueWhereLeftOff() {
  if (!state.tracks.length) return toast(t('toast.addFilesFirst'));
  let target = state.tracks.findIndex((track) => {
    const progress = state.progress.get(track.id);
    return progress && !progress.played && progress.position > 5;
  });
  if (target < 0) target = state.tracks.findIndex((track) => !state.progress.get(track.id)?.played);
  if (target < 0) target = 0;
  await playTrack(target);
}

function renderPlayerState(snapshot, extra) {
  const { track, playing, currentTime, duration, index, total } = snapshot;

  const playIcons = document.querySelectorAll('#btn-play .icon-play, #mini-play .icon-play');
  const pauseIcons = document.querySelectorAll('#btn-play .icon-pause, #mini-play .icon-pause');
  playIcons.forEach((icon) => icon.classList.toggle('hidden', playing));
  pauseIcons.forEach((icon) => icon.classList.toggle('hidden', !playing));
  $('#btn-play').setAttribute('aria-label', playing ? t('aria.pause') : t('aria.play'));

  const disabled = !track;
  for (const id of ['#btn-back', '#btn-forward', '#btn-stop', '#btn-prev', '#btn-next']) {
    $(id).disabled = disabled;
  }

  $('#player-title').textContent = track ? track.title : t('player.nothing');
  $('#player-position-label').textContent = track
    ? t('player.lessonOf', { index: index + 1, total }) + (state.course ? ` · ${state.course.title}` : '')
    : t('player.pickLesson');

  const badge = $('#repeat-badge');
  const { repeatTarget, repeatPass, breaking, breakRemaining } = snapshot;
  const showBadge = Boolean(track) && (repeatTarget > 1 || breaking);
  if (badge) {
    badge.classList.toggle('hidden', !showBadge);
    badge.classList.toggle('is-break', Boolean(breaking));
    if (showBadge) {
      if (breaking) {
        badge.textContent = t('player.breakIn', { seconds: breakRemaining });
      } else {
        badge.textContent = repeatTarget === Infinity
          ? t('player.repeating', { pass: repeatPass })
          : t('player.playOf', { pass: repeatPass, total: repeatTarget });
      }
    }
  }

  const sleepBadge = $('#sleep-badge');
  const showSleep = snapshot.sleepRemainingMs > 0;
  if (sleepBadge) {
    sleepBadge.classList.toggle('hidden', !showSleep);
    if (showSleep) {
      sleepBadge.textContent = t('player.sleepIn', { time: formatTime(snapshot.sleepRemainingMs / 1000) });
    }
  }

  $('#time-current').textContent = formatTime(currentTime);
  $('#time-total').textContent = formatTime(duration);
  if (!state.seeking) {
    $('#seek').value = duration ? String(Math.round((currentTime / duration) * 1000)) : '0';
  }

  updateMiniPlayer(snapshot);

  if (extra?.loadError) toast(t('toast.playFailed', { title: player.currentTrack?.title || '' }));
  if (extra?.sleepFired) {
    setControl('#sleep-minutes', '0');
    $('#sleep-badge')?.classList.add('hidden');
    toast(t('toast.sleepFired'));
  }

  if (extra?.playedChanged) {
    getProgress(extra.playedChanged).then((row) => {
      if (row) state.progress.set(row.trackId, row);
      renderTracks();
      renderCourseSummary();
    });
  } else {
    highlightCurrentRow(track?.id);
  }
}

function highlightCurrentRow(trackId) {
  const rows = document.querySelectorAll('#track-list .track-row');
  state.tracks.forEach((track, index) => {
    rows[index]?.classList.toggle('is-current', track.id === trackId);
  });
}

function updateMiniPlayer(snapshot = player.snapshot()) {
  const bar = $('#mini-player');
  const show = Boolean(snapshot.track) && state.screen !== 'player';
  bar.classList.toggle('hidden', !show);
  if (!show) return;
  $('#mini-title').textContent = snapshot.track.title;
  $('#mini-sub').textContent = `${state.course?.title || ''} · ${formatTime(snapshot.currentTime)} / ${formatTime(snapshot.duration)}`;
}

/* ====================================================================== */
/* Importing                                                               */
/* ====================================================================== */

async function handleFiles(fileList) {
  if (!state.course || !fileList?.length) return;
  showBusy(t('toast.copyingTitle'), 0);
  try {
    const result = await importFiles(state.course.id, fileList, ({ processed, total, name }) => {
      showBusy(t('toast.copying', { name }), total ? processed / total : 0);
    });
    await refreshTracks();
    await refreshStorageLine();
    hideBusy();

    if (!result.considered) toast(t('toast.noAudioFound'));
    else if (!result.added.length) toast(t('toast.alreadyAdded'));
    else toast(result.added.length === 1 ? t('toast.addedOne') : t('toast.added', { count: result.added.length }));

    if (result.added.length) {
      probeDurations(result.added, getTrackBlob, () => {}).then(async () => {
        await refreshTracks();
        await renderLibrary();
      });
    }
  } catch (error) {
    hideBusy();
    toast(error.message || t('toast.importFailed'));
  }
}

/* ====================================================================== */
/* Events                                                                  */
/* ====================================================================== */

function wireEvents() {
  for (const button of document.querySelectorAll('[data-nav]')) {
    button.addEventListener('click', () => navigate(button.dataset.nav));
  }

  /* --- welcome --- */
  $('#btn-add-course').addEventListener('click', () => openCourseDialog());
  $('#btn-settings').addEventListener('click', openSettings);

  /* --- course --- */
  $('#btn-add-files').addEventListener('click', () => $('#file-input').click());
  $('#btn-add-folder').addEventListener('click', () => $('#folder-input').click());
  $('#btn-continue').addEventListener('click', continueWhereLeftOff);
  $('#btn-course-menu').addEventListener('click', () => $('#dlg-course-menu').showModal());

  $('#file-input').addEventListener('change', (event) => {
    handleFiles(event.target.files);
    event.target.value = '';
  });
  $('#folder-input').addEventListener('change', (event) => {
    handleFiles(event.target.files);
    event.target.value = '';
  });

  /* --- transport --- */
  $('#btn-play').addEventListener('click', () => player.toggle());
  $('#btn-back').addEventListener('click', () => player.back());
  $('#btn-forward').addEventListener('click', () => player.forward());
  $('#btn-prev').addEventListener('click', () => player.previous());
  $('#btn-next').addEventListener('click', () => player.next());
  $('#btn-stop').addEventListener('click', () => player.stop());

  $('#mini-play').addEventListener('click', () => player.toggle());
  $('#mini-back').addEventListener('click', () => player.back());
  $('#mini-forward').addEventListener('click', () => player.forward());
  $('#mini-open').addEventListener('click', () => navigate('player'));

  const seek = $('#seek');
  const startSeek = () => { state.seeking = true; };
  const endSeek = () => {
    const snapshot = player.snapshot();
    if (snapshot.duration) player.seekTo((Number(seek.value) / 1000) * snapshot.duration);
    state.seeking = false;
  };
  seek.addEventListener('pointerdown', startSeek);
  seek.addEventListener('touchstart', startSeek, { passive: true });
  seek.addEventListener('input', () => {
    const snapshot = player.snapshot();
    if (snapshot.duration) $('#time-current').textContent = formatTime((Number(seek.value) / 1000) * snapshot.duration);
  });
  seek.addEventListener('change', endSeek);
  seek.addEventListener('pointerup', endSeek);

  $('#rate').addEventListener('change', (event) => {
    const value = Number(event.target.value);
    player.setRate(value);
    setSetting('playbackRate', value);
  });
  $('#repeat').addEventListener('change', (event) => {
    const raw = event.target.value;
    player.setRepeat(parseRepeat(raw));
    setSetting('repeat', raw);
    const target = parseRepeat(raw);
    toast(target === Infinity ? t('toast.repeatInf')
      : target === 1 ? t('toast.repeatOff')
      : t('toast.repeatTimes', { count: target }));
  });
  on('#back-seconds', 'change', (event) => {
    const value = Number(event.target.value);
    player.setBackSeconds(value);
    setSetting('backSeconds', value);
    updateSkipLabels();
  });
  on('#forward-seconds', 'change', (event) => {
    const value = Number(event.target.value);
    player.setForwardSeconds(value);
    setSetting('forwardSeconds', value);
    updateSkipLabels();
  });
  on('#break-seconds', 'change', (event) => {
    const value = Number(event.target.value);
    player.setBreakSeconds(value);
    setSetting('breakSeconds', value);
    toast(value ? t('toast.breakOn', { seconds: value }) : t('toast.breakOff'));
  });
  on('#sleep-minutes', 'change', (event) => {
    const value = Number(event.target.value);
    player.setSleepMinutes(value);
    toast(value ? t('toast.sleepOn', { minutes: value }) : t('toast.sleepOff'));
  });
  on('#auto-advance', 'change', (event) => {
    player.autoAdvance = event.target.checked;
    setSetting('autoAdvance', event.target.checked);
  });
  on('#btn-reset-controls', 'click', resetControls);
  on('#language-toggle', 'click', (event) => {
    const button = event.target.closest('.segment');
    if (button) applyLanguage(button.dataset.lang);
  });
  on('#orientation-toggle', 'click', (event) => {
    const button = event.target.closest('.segment');
    if (button) applyOrientation(button.dataset.orientation, { announce: true });
  });

  /* --- keyboard shortcuts (PC) --- */
  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, select, textarea')) return;
    switch (event.key) {
      case ' ': event.preventDefault(); player.toggle(); break;
      case 'ArrowLeft': player.back(); break;
      case 'ArrowRight': player.forward(); break;
      case 'ArrowUp': player.previous(); break;
      case 'ArrowDown': player.next(); break;
      case 'Escape': if (state.screen === 'player') navigate('course'); break;
      default: break;
    }
  });

  /* --- course dialog --- */
  const courseDialog = $('#dlg-course');
  $('#title-suggestions').addEventListener('click', (event) => {
    if (!event.target.classList.contains('chip')) return;
    $('#course-title-input').value = event.target.textContent;
    updateCoverPreview();
  });
  $('#course-title-input').addEventListener('input', updateCoverPreview);
  $('#btn-choose-cover').addEventListener('click', () => $('#cover-input').click());
  $('#btn-remove-cover').addEventListener('click', () => {
    state.pendingCover = 'remove';
    updateCoverPreview();
  });
  $('#cover-input').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      state.pendingCover = await prepareCover(file);
      updateCoverPreview();
    } catch (error) {
      toast(error.message || t('toast.pictureFailed'));
    }
  });

  courseDialog.addEventListener('close', async () => {
    const pendingCover = state.pendingCover;
    state.pendingCover = null;
    if (courseDialog.returnValue !== 'save') return;
    const title = $('#course-title-input').value.trim();
    if (!title) return;
    const subtitle = $('#course-subtitle-input').value.trim();
    const editingId = courseDialog.dataset.editing;

    if (editingId) {
      await updateCourse(editingId, { title, subtitle });
      await applyPendingCover(editingId, pendingCover);
      if (state.course?.id === editingId) await openCourse(editingId, { navigate: false });
      toast(pendingCover ? t('toast.courseUpdated') : t('toast.courseRenamed'));
    } else {
      const course = await createCourse({ title, subtitle });
      await applyPendingCover(course.id, pendingCover);
      await renderLibrary();
      await openCourse(course.id);
      toast(t('toast.nowAddFiles'));
      return;
    }
    await renderLibrary();
  });

  /* --- course options --- */
  $('#btn-rename-course').addEventListener('click', () => {
    $('#dlg-course-menu').close();
    openCourseDialog(state.course);
  });
  $('#btn-mark-all-unplayed').addEventListener('click', async () => {
    if (!state.course) return;
    if (!confirm(t('confirm.resetProgress', { title: state.course.title, device: state.device.name }))) return;
    await resetCourseProgress(state.course.id);
    $('#dlg-course-menu').close();
    await refreshTracks();
    await renderLibrary();
    toast(t('toast.progressReset'));
  });
  $('#btn-delete-course').addEventListener('click', async () => {
    if (!state.course) return;
    if (!confirm(t('confirm.deleteCourse', { title: state.course.title }))) return;
    player.unload();
    const deletedId = state.course.id;
    await deleteCourse(deletedId);
    forgetCover(deletedId);
    state.course = null;
    state.tracks = [];
    $('#dlg-course-menu').close();
    await renderLibrary();
    await refreshStorageLine();
    navigate('welcome');
    toast(t('toast.courseDeleted'));
  });

  /* --- settings --- */
  $('#dlg-settings').addEventListener('close', async () => {
    const name = $('#device-name-input').value.trim();
    if (name && name !== state.device.name) {
      await setDeviceName(name);
      state.device = await getDevice();
      renderDeviceLine();
      renderCourseSummary();
    }
  });
  $('#btn-persist').addEventListener('click', async () => {
    const granted = await requestPersistentStorage();
    toast(granted ? t('toast.protectedOk') : t('toast.protectedNo'));
    await refreshStorageLine();
    await fillSettingsStorage();
  });
  $('#btn-export').addEventListener('click', exportReport);

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') player._flushProgress();
  });
  window.addEventListener('pagehide', () => player._flushProgress());

  // Keeps the sleep countdown ticking even while playback is paused. The timer
  // itself is driven by media events, so this only refreshes what is shown.
  setInterval(() => {
    if (player.sleepEndsAt) renderPlayerState(player.snapshot());
  }, 1000);
}

function updateSkipLabels() {
  for (const label of document.querySelectorAll('[data-back-label]')) {
    label.textContent = String(player.backSeconds);
  }
  for (const label of document.querySelectorAll('[data-forward-label]')) {
    label.textContent = String(player.forwardSeconds);
  }
  $('#btn-back')?.setAttribute('aria-label', t('aria.skipBack', { seconds: player.backSeconds }));
  $('#btn-forward')?.setAttribute('aria-label', t('aria.skipForward', { seconds: player.forwardSeconds }));
}

async function openCourseDialog(course = null) {
  const dialog = $('#dlg-course');
  dialog.dataset.editing = course?.id || '';
  $('#dlg-course-heading').textContent = course ? t('dialog.editLanguage') : t('dialog.addLanguage');
  $('#course-title-input').value = course?.title || '';
  $('#course-subtitle-input').value = course?.subtitle || '';
  $('#title-suggestions').classList.toggle('hidden', Boolean(course));

  state.pendingCover = null;
  dialog.dataset.existingCover = course ? await coverUrl(course) || '' : '';
  updateCoverPreview();

  dialog.showModal();
}

/**
 * Shows whichever picture would be saved right now: the newly chosen one, the
 * one already stored, or the fallback letter.
 */
function updateCoverPreview() {
  const dialog = $('#dlg-course');
  const preview = $('#cover-preview');
  if (!dialog || !preview) return;
  const letter = initials($('#course-title-input').value || 'A');

  if (preview.dataset.tempUrl) {
    URL.revokeObjectURL(preview.dataset.tempUrl);
    delete preview.dataset.tempUrl;
  }

  let url = null;
  if (state.pendingCover instanceof Blob) {
    url = URL.createObjectURL(state.pendingCover);
    preview.dataset.tempUrl = url;
  } else if (state.pendingCover !== 'remove') {
    url = dialog.dataset.existingCover || null;
  }

  paintCover(preview, url, letter);
  $('#btn-choose-cover').textContent = url ? t('dialog.changePicture') : t('dialog.choosePicture');
  $('#btn-remove-cover').classList.toggle('hidden', !url);
}

async function applyPendingCover(courseId, pendingCover) {
  if (!pendingCover) return;
  if (pendingCover === 'remove') await deleteCourseCover(courseId);
  else await setCourseCover(courseId, pendingCover);
  forgetCover(courseId);
}

async function openSettings() {
  $('#device-name-input').value = state.device.name;
  markSegments('#language-toggle', 'lang', getLanguage());
  markSegments('#orientation-toggle', 'orientation', await getSetting('orientation', 'auto'));
  await fillSettingsStorage();
  $('#dlg-settings').showModal();
}

async function fillSettingsStorage() {
  const estimate = await storageEstimate();
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  $('#settings-storage').textContent = estimate?.usage
    ? t('settings.usage', {
      used: formatBytes(estimate.usage),
      quota: estimate.quota ? t('settings.usageOf', { quota: formatBytes(estimate.quota) }) : '',
    }) + (persisted ? t('settings.protectedYes') : t('settings.protectedNo'))
    : '';
}

async function exportReport() {
  const report = await exportProgressReport();
  const json = JSON.stringify(report, null, 2);
  const fileName = `listening-report-${slug(state.device.name)}.json`;

  // On phones and tablets the share sheet is far more reliable than a download.
  try {
    const file = new File([json], fileName, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Listening report' });
      return;
    }
  } catch (error) {
    if (error.name === 'AbortError') return;
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  toast(t('toast.reportSaved'));
}

/* ====================================================================== */
/* Small helpers                                                           */
/* ====================================================================== */

let toastTimer = 0;
function toast(message) {
  const element = $('#toast');
  element.textContent = message;
  element.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => element.classList.add('hidden'), 3200);
}

function showBusy(text, ratio) {
  $('#busy-text').textContent = text;
  $('#busy-fill').style.width = `${Math.round((ratio || 0) * 100)}%`;
  $('#busy').classList.remove('hidden');
}
function hideBusy() { $('#busy').classList.add('hidden'); }

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`;
}

function formatDuration(seconds) {
  if (!seconds) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  if (hours && minutes) return `${hours} h ${minutes} min`;
  if (hours) return `${hours} h`;
  return `${Math.max(1, minutes)} min`;
}

function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function relativeDate(timestamp) {
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return t('date.today');
  if (days === 1) return t('date.yesterday');
  if (days < 30) return t('date.daysAgo', { count: days });
  return new Date(timestamp).toLocaleDateString();
}

function initials(title) {
  const words = title.replace(/^(le|la|les|l'|the|el)\s+/i, '').trim().split(/\s+/);
  return (words[0]?.[0] || 'A').toUpperCase();
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'device';
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

/**
 * If the database cannot be opened the library is unknown, not empty. Showing
 * the usual "No languages yet" panel would wrongly suggest the courses were
 * lost, so an explicit error is shown instead.
 */
function showStartupError(error) {
  console.error(error);
  $('#empty-library').classList.add('hidden');
  $('#course-grid').innerHTML = '';
  $('#btn-add-course').classList.add('hidden');
  $('#startup-error-text').textContent = error?.message ||
    'Something went wrong while opening the stored courses.';
  $('#startup-error').classList.remove('hidden');
}

$('#btn-retry-startup').addEventListener('click', () => window.location.reload());

init().catch(showStartupError);
