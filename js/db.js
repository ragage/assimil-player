/**
 * Storage layer - IndexedDB.
 *
 * Everything lives on the device: course metadata, the MP3 binaries themselves,
 * and the listening progress. Because IndexedDB is per-origin *per-device*,
 * play tracking is automatically isolated to each phone / iPad / PC.
 */

const DB_NAME = 'assimil-player';
const DB_VERSION = 2;

const STORE_COURSES = 'courses';
const STORE_TRACKS = 'tracks';
const STORE_BLOBS = 'blobs';
const STORE_PROGRESS = 'progress';
const STORE_SETTINGS = 'settings';
const STORE_COVERS = 'covers';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_COURSES)) {
        db.createObjectStore(STORE_COURSES, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_TRACKS)) {
        const tracks = db.createObjectStore(STORE_TRACKS, { keyPath: 'id' });
        tracks.createIndex('byCourse', 'courseId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: 'trackId' });
      }

      if (!db.objectStoreNames.contains(STORE_PROGRESS)) {
        const progress = db.createObjectStore(STORE_PROGRESS, { keyPath: 'trackId' });
        progress.createIndex('byCourse', 'courseId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
        db.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
      }

      // v2: cover pictures, kept in their own store so listing courses does
      // not have to pull image data into memory.
      if (!db.objectStoreNames.contains(STORE_COVERS)) {
        db.createObjectStore(STORE_COVERS, { keyPath: 'courseId' });
      }
    };

    request.onsuccess = () => {
      const db = request.result;
      // If another tab loads a newer version of the app, step aside so its
      // upgrade can run instead of deadlocking both tabs.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };

    request.onerror = () => {
      dbPromise = null;
      reject(request.error);
    };

    request.onblocked = () => {
      dbPromise = null;
      reject(new Error(
        'The app is open in another tab or window that is still using an older version. ' +
        'Close the other tabs, then reload this page.'
      ));
    };
  });

  return dbPromise;
}

async function tx(storeNames, mode, work) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    let result;
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Transaction aborted'));
    try {
      result = work(transaction);
      if (result && typeof result.then === 'function') {
        result.then((value) => { result = value; }, reject);
      }
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

function req(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function newId(prefix) {
  const random = (crypto.randomUUID && crypto.randomUUID()) ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}_${random}` : random;
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export async function getSetting(key, fallback = null) {
  const db = await openDb();
  const store = db.transaction(STORE_SETTINGS, 'readonly').objectStore(STORE_SETTINGS);
  const row = await req(store.get(key));
  return row ? row.value : fallback;
}

export async function setSetting(key, value) {
  return tx(STORE_SETTINGS, 'readwrite', (transaction) => {
    transaction.objectStore(STORE_SETTINGS).put({ key, value });
  });
}

/* ------------------------------------------------------------------ */
/* Courses                                                             */
/* ------------------------------------------------------------------ */

export async function listCourses() {
  const db = await openDb();
  const store = db.transaction(STORE_COURSES, 'readonly').objectStore(STORE_COURSES);
  const courses = await req(store.getAll());
  courses.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.title.localeCompare(b.title));
  return courses;
}

export async function getCourse(courseId) {
  const db = await openDb();
  const store = db.transaction(STORE_COURSES, 'readonly').objectStore(STORE_COURSES);
  return req(store.get(courseId));
}

export async function createCourse({ title, subtitle = '', accent = null }) {
  const existing = await listCourses();
  const course = {
    id: newId('course'),
    title: title.trim(),
    subtitle: subtitle.trim(),
    accent: accent || pickAccent(existing),
    createdAt: Date.now(),
    sortOrder: existing.length,
  };
  await tx(STORE_COURSES, 'readwrite', (transaction) => {
    transaction.objectStore(STORE_COURSES).put(course);
  });
  return course;
}

export async function updateCourse(courseId, changes) {
  const db = await openDb();
  const course = await req(db.transaction(STORE_COURSES, 'readonly').objectStore(STORE_COURSES).get(courseId));
  if (!course) throw new Error('Course not found');
  const updated = { ...course, ...changes, id: courseId };
  await tx(STORE_COURSES, 'readwrite', (transaction) => {
    transaction.objectStore(STORE_COURSES).put(updated);
  });
  return updated;
}

export async function deleteCourse(courseId) {
  const tracks = await listTracks(courseId);
  await tx([STORE_COURSES, STORE_TRACKS, STORE_BLOBS, STORE_PROGRESS, STORE_COVERS], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_COURSES).delete(courseId);
    transaction.objectStore(STORE_COVERS).delete(courseId);
    const trackStore = transaction.objectStore(STORE_TRACKS);
    const blobStore = transaction.objectStore(STORE_BLOBS);
    const progressStore = transaction.objectStore(STORE_PROGRESS);
    for (const track of tracks) {
      trackStore.delete(track.id);
      blobStore.delete(track.id);
      progressStore.delete(track.id);
    }
  });
}

/* ------------------------------------------------------------------ */
/* Cover pictures                                                      */
/* ------------------------------------------------------------------ */

/**
 * Stores the cover image for a course and flags the course record, so the
 * library can tell which courses have artwork without reading the images.
 */
export async function setCourseCover(courseId, blob) {
  const course = await getCourse(courseId);
  if (!course) throw new Error('Course not found');
  await tx([STORE_COVERS, STORE_COURSES], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_COVERS).put({ courseId, blob, updatedAt: Date.now() });
    transaction.objectStore(STORE_COURSES).put({ ...course, hasCover: true, coverUpdatedAt: Date.now() });
  });
}

export async function getCourseCover(courseId) {
  const db = await openDb();
  const store = db.transaction(STORE_COVERS, 'readonly').objectStore(STORE_COVERS);
  const row = await req(store.get(courseId));
  return row ? row.blob : null;
}

export async function deleteCourseCover(courseId) {
  const course = await getCourse(courseId);
  await tx([STORE_COVERS, STORE_COURSES], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_COVERS).delete(courseId);
    if (course) {
      transaction.objectStore(STORE_COURSES).put({ ...course, hasCover: false, coverUpdatedAt: Date.now() });
    }
  });
}

const ACCENTS = ['#4f8cff', '#f2596b', '#38b48b', '#c77dff', '#f0a23c', '#26b8c4'];

/** Prefers a colour that no existing course is using, so cards stay distinct. */
function pickAccent(existingCourses) {
  const used = new Set(existingCourses.map((course) => course.accent));
  return ACCENTS.find((colour) => !used.has(colour)) || ACCENTS[existingCourses.length % ACCENTS.length];
}

/* ------------------------------------------------------------------ */
/* Tracks + audio blobs                                                */
/* ------------------------------------------------------------------ */

export async function listTracks(courseId) {
  const db = await openDb();
  const index = db.transaction(STORE_TRACKS, 'readonly').objectStore(STORE_TRACKS).index('byCourse');
  const tracks = await req(index.getAll(courseId));
  tracks.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  return tracks;
}

export async function getTrack(trackId) {
  const db = await openDb();
  const store = db.transaction(STORE_TRACKS, 'readonly').objectStore(STORE_TRACKS);
  return req(store.get(trackId));
}

/**
 * Persists one imported audio file plus its binary content.
 */
export async function addTrack({ courseId, title, fileName, blob, size, mimeType, duration, sortOrder }) {
  const track = {
    id: newId('track'),
    courseId,
    title,
    fileName,
    size,
    mimeType,
    duration: duration ?? null,
    sortOrder,
    addedAt: Date.now(),
  };

  await tx([STORE_TRACKS, STORE_BLOBS], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_TRACKS).put(track);
    transaction.objectStore(STORE_BLOBS).put({ trackId: track.id, blob });
  });

  return track;
}

export async function getTrackBlob(trackId) {
  const db = await openDb();
  const store = db.transaction(STORE_BLOBS, 'readonly').objectStore(STORE_BLOBS);
  const row = await req(store.get(trackId));
  return row ? row.blob : null;
}

export async function deleteTrack(trackId) {
  await tx([STORE_TRACKS, STORE_BLOBS, STORE_PROGRESS], 'readwrite', (transaction) => {
    transaction.objectStore(STORE_TRACKS).delete(trackId);
    transaction.objectStore(STORE_BLOBS).delete(trackId);
    transaction.objectStore(STORE_PROGRESS).delete(trackId);
  });
}

export async function reorderTracks(orderedTrackIds) {
  const db = await openDb();
  const store = db.transaction(STORE_TRACKS, 'readonly').objectStore(STORE_TRACKS);
  const tracks = [];
  for (const id of orderedTrackIds) {
    const track = await req(store.get(id));
    if (track) tracks.push(track);
  }
  await tx(STORE_TRACKS, 'readwrite', (transaction) => {
    const writeStore = transaction.objectStore(STORE_TRACKS);
    tracks.forEach((track, index) => writeStore.put({ ...track, sortOrder: index }));
  });
}

export async function setTrackDuration(trackId, duration) {
  const track = await getTrack(trackId);
  if (!track || track.duration) return;
  await tx(STORE_TRACKS, 'readwrite', (transaction) => {
    transaction.objectStore(STORE_TRACKS).put({ ...track, duration });
  });
}

/* ------------------------------------------------------------------ */
/* Progress (per device, because the database is local to the device)  */
/* ------------------------------------------------------------------ */

export async function getProgressForCourse(courseId) {
  const db = await openDb();
  const index = db.transaction(STORE_PROGRESS, 'readonly').objectStore(STORE_PROGRESS).index('byCourse');
  const rows = await req(index.getAll(courseId));
  const map = new Map();
  for (const row of rows) map.set(row.trackId, row);
  return map;
}

export async function getProgress(trackId) {
  const db = await openDb();
  const store = db.transaction(STORE_PROGRESS, 'readonly').objectStore(STORE_PROGRESS);
  return req(store.get(trackId));
}

/**
 * Merges `changes` into the stored progress row inside a single transaction, so
 * a concurrent write (for example the player flushing its position) can never
 * clobber a flag written a moment earlier. `changes` may be an object or a
 * function receiving the current row.
 */
export async function saveProgress(trackId, courseId, changes) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_PROGRESS, 'readwrite');
    const store = transaction.objectStore(STORE_PROGRESS);
    const getRequest = store.get(trackId);
    let updated = null;

    getRequest.onsuccess = () => {
      const existing = getRequest.result || {
        trackId,
        courseId,
        played: false,
        position: 0,
        playCount: 0,
        lastPlayedAt: null,
      };
      const patch = typeof changes === 'function' ? changes(existing) : changes;
      updated = { ...existing, ...patch, trackId, courseId };
      store.put(updated);
    };

    transaction.oncomplete = () => resolve(updated);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('Progress write aborted'));
  });
}

export async function resetCourseProgress(courseId) {
  const tracks = await listTracks(courseId);
  await tx(STORE_PROGRESS, 'readwrite', (transaction) => {
    const store = transaction.objectStore(STORE_PROGRESS);
    for (const track of tracks) store.delete(track.id);
  });
}

export async function countsForCourse(courseId) {
  const [tracks, progress] = await Promise.all([listTracks(courseId), getProgressForCourse(courseId)]);
  let played = 0;
  let started = 0;
  let totalBytes = 0;
  let totalSeconds = 0;
  for (const track of tracks) {
    totalBytes += track.size || 0;
    totalSeconds += track.duration || 0;
    const row = progress.get(track.id);
    if (row?.played) played += 1;
    else if (row && row.position > 5) started += 1;
  }
  return { total: tracks.length, played, started, totalBytes, totalSeconds };
}

/* ------------------------------------------------------------------ */
/* Device identity + storage housekeeping                              */
/* ------------------------------------------------------------------ */

export async function getDevice() {
  let id = await getSetting('deviceId');
  if (!id) {
    id = newId('device');
    await setSetting('deviceId', id);
  }
  let name = await getSetting('deviceName');
  if (!name) {
    name = guessDeviceName();
    await setSetting('deviceName', name);
  }
  return { id, name };
}

export async function setDeviceName(name) {
  await setSetting('deviceName', name.trim() || guessDeviceName());
}

function guessDeviceName() {
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'My iPad';
  if (/iPhone/i.test(ua)) return 'My iPhone';
  if (/Android/i.test(ua)) return 'My Android phone';
  if (/Windows/i.test(ua)) return 'My PC';
  if (/Macintosh/i.test(ua)) return 'My Mac';
  return 'This device';
}

/**
 * Asks the browser to make storage persistent so the operating system does not
 * evict the downloaded MP3 files when disk space runs low.
 */
export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return null;
  if (await navigator.storage.persisted()) return true;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return null;
  try {
    return await navigator.storage.estimate();
  } catch {
    return null;
  }
}

export async function exportProgressReport() {
  const device = await getDevice();
  const courses = await listCourses();
  const report = { device, exportedAt: new Date().toISOString(), courses: [] };
  for (const course of courses) {
    const tracks = await listTracks(course.id);
    const progress = await getProgressForCourse(course.id);
    report.courses.push({
      title: course.title,
      subtitle: course.subtitle,
      tracks: tracks.map((track) => {
        const row = progress.get(track.id);
        return {
          title: track.title,
          played: Boolean(row?.played),
          playCount: row?.playCount || 0,
          positionSeconds: Math.round(row?.position || 0),
          lastPlayedAt: row?.lastPlayedAt ? new Date(row.lastPlayedAt).toISOString() : null,
        };
      }),
    });
  }
  return report;
}
