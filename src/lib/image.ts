import { PHOTO_MAX_SIDE } from '../../shared/config';

export interface PreparedPhoto {
  blob: Blob;
  ext: 'webp' | 'jpg';
}

type Decoded = (ImageBitmap | HTMLImageElement) & { width: number; height: number };

async function decode(file: File): Promise<Decoded> {
  if ('createImageBitmap' in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      /* ниже — запасной путь */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Декодирует и заново кодирует фото: большая сторона до 1600 px. EXIF (в том числе геометка)
 * не переносится, потому что canvas хранит только пиксели.
 */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  const img = await decode(file);
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  ctx.drawImage(img, 0, 0, w, h);
  if (img instanceof ImageBitmap) img.close();

  const webp = await toBlob(canvas, 'image/webp', 0.82);
  if (webp && webp.type === 'image/webp') return { blob: webp, ext: 'webp' };
  // Браузер без кодировщика WebP
  const jpeg = await toBlob(canvas, 'image/jpeg', 0.85);
  if (!jpeg) throw new Error('encode');
  return { blob: jpeg, ext: 'jpg' };
}
