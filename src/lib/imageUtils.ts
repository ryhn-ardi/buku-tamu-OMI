import { SCHEMA_LIMITS } from '../types/guestbook';

/**
 * Compresses an uploaded image file to a JPEG Data URL guaranteed to stay
 * within Firestore schema limits (<= 350,000 chars).
 */
export async function compressImageFileToDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('File yang dipilih harus berupa gambar (JPG, PNG, atau WebP).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Gagal membaca file gambar.'));
      image.src = objectUrl;
    });

    const maxDimension = 1280;
    let width = img.naturalWidth || img.width;
    let height = img.naturalHeight || img.height;

    if (width > maxDimension) {
      height = Math.round((height * maxDimension) / width);
      width = maxDimension;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser tidak mendukung pemrosesan gambar.');
    }

    ctx.fillStyle = '#0F172A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const qualities = [0.82, 0.7, 0.56, 0.42];
    for (const q of qualities) {
      const dataUrl = canvas.toDataURL('image/jpeg', q);
      if (dataUrl.length <= SCHEMA_LIMITS.bannerImageMax - 10000) {
        return dataUrl;
      }
    }

    // Final smaller scale pass if image is still dense
    const smallCanvas = document.createElement('canvas');
    smallCanvas.width = Math.max(1, Math.round(canvas.width * 0.65));
    smallCanvas.height = Math.max(1, Math.round(canvas.height * 0.65));
    const smallCtx = smallCanvas.getContext('2d');
    if (smallCtx) {
      smallCtx.drawImage(canvas, 0, 0, smallCanvas.width, smallCanvas.height);
      const smallerUrl = smallCanvas.toDataURL('image/jpeg', 0.65);
      if (smallerUrl.length <= SCHEMA_LIMITS.bannerImageMax) {
        return smallerUrl;
      }
    }

    throw new Error('Ukuran gambar terlalu besar. Pilih gambar yang lebih ringan.');
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
