/**
 * Offline import of audio files into the device database.
 */

import { addTrack, listTracks, setTrackDuration } from './db.js';

const AUDIO_EXTENSIONS = /\.(mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac|webm)$/i;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function isAudioFile(file) {
  return (file.type && file.type.startsWith('audio/')) || AUDIO_EXTENSIONS.test(file.name);
}

export function naturalSort(a, b) {
  return collator.compare(a, b);
}

export function titleFromFileName(fileName) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/[_]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim() || fileName;
}

/**
 * Imports the selected files into a course.
 * Files already present (same name and size) are skipped so re-importing a
 * folder does not create duplicates.
 */
export async function importFiles(courseId, fileList, onProgress) {
  const files = Array.from(fileList).filter(isAudioFile);
  files.sort((a, b) => naturalSort(relPath(a), relPath(b)));

  const existing = await listTracks(courseId);
  const seen = new Set(existing.map((track) => `${track.fileName}|${track.size}`));
  let sortOrder = existing.length;

  const added = [];
  let processed = 0;

  for (const file of files) {
    const key = `${file.name}|${file.size}`;
    processed += 1;
    if (seen.has(key)) {
      onProgress?.({ processed, total: files.length, name: file.name, skipped: true });
      continue;
    }
    seen.add(key);

    const track = await addTrack({
      courseId,
      title: titleFromFileName(file.name),
      fileName: file.name,
      blob: file,
      size: file.size,
      mimeType: file.type || 'audio/mpeg',
      duration: null,
      sortOrder: sortOrder++,
    });
    added.push(track);
    onProgress?.({ processed, total: files.length, name: file.name, skipped: false });
  }

  return { added, skipped: files.length - added.length, considered: files.length };
}

function relPath(file) {
  return file.webkitRelativePath || file.name;
}

/**
 * Reads durations in the background so the course list can show total time.
 * Runs one file at a time to keep memory use low on phones.
 */
export async function probeDurations(tracks, getBlob, onUpdate) {
  for (const track of tracks) {
    if (track.duration) continue;
    try {
      const blob = await getBlob(track.id);
      if (!blob) continue;
      const duration = await readDuration(blob);
      if (duration) {
        await setTrackDuration(track.id, duration);
        track.duration = duration;
        onUpdate?.(track);
      }
    } catch {
      /* a single unreadable file must not stop the batch */
    }
  }
}

function readDuration(blob) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const probe = new Audio();
    const finish = (value) => {
      URL.revokeObjectURL(url);
      probe.removeAttribute('src');
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 15000);
    probe.preload = 'metadata';
    probe.addEventListener('loadedmetadata', () => {
      clearTimeout(timer);
      finish(Number.isFinite(probe.duration) ? probe.duration : null);
    }, { once: true });
    probe.addEventListener('error', () => {
      clearTimeout(timer);
      finish(null);
    }, { once: true });
    probe.src = url;
  });
}
