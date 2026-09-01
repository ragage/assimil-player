/**
 * Cover picture handling.
 *
 * Pictures chosen from the camera roll are far larger than the app needs, so
 * they are downscaled and re-encoded before being stored. A phone photo of
 * several megabytes becomes a few tens of kilobytes, which keeps the device
 * storage free for the audio.
 */

const MAX_EDGE = 640;      // longest side, in pixels
const QUALITY = 0.82;
const MAX_INPUT_BYTES = 40 * 1024 * 1024;

export function isImageFile(file) {
  return (file.type && file.type.startsWith('image/')) ||
    /\.(jpe?g|png|gif|webp|avif|bmp|heic|heif)$/i.test(file.name);
}

/**
 * Decodes, downscales and re-encodes a picture.
 * Returns a Blob ready to be stored, or throws a message fit to show the user.
 */
export async function prepareCover(file) {
  if (!isImageFile(file)) throw new Error('That file is not a picture.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('That picture is too large to read.');

  const source = await decode(file);
  const { width, height } = source;
  if (!width || !height) throw new Error('That picture could not be read.');

  const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext('2d');
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, targetWidth, targetHeight);
  if (source.close) source.close();

  const blob = await encode(canvas);
  if (!blob) throw new Error('That picture could not be saved.');

  // Re-encoding tiny images can make them bigger; keep whichever is smaller.
  // The original is copied into a standalone Blob first, because a File from
  // the picker would stop working once the picture is moved or deleted.
  if (scale === 1 && file.size < blob.size && file.type && file.type !== 'image/heic') {
    return new Blob([await file.arrayBuffer()], { type: file.type });
  }
  return blob;
}

async function decode(file) {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      // Safari rejects the options bag on older versions; try without it.
      try {
        return await createImageBitmap(file);
      } catch { /* fall through to the <img> path */ }
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('This device cannot read that picture format.'));
      image.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

function encode(canvas) {
  return new Promise((resolve) => {
    // WebP is markedly smaller; browsers that cannot encode it fall back to JPEG.
    canvas.toBlob((webp) => {
      if (webp && webp.type === 'image/webp') return resolve(webp);
      canvas.toBlob((jpeg) => resolve(jpeg), 'image/jpeg', QUALITY);
    }, 'image/webp', QUALITY);
  });
}
