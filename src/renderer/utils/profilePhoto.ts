/**
 * Downscale a user-picked image file to a square JPEG data URI suitable for
 * inline profile photos (participant cards, agent configs).
 */
export const MAX_PROFILE_PHOTO_SIZE = 256;

export function resizeProfilePhoto(file: File): Promise<string> {
  const { promise, resolve, reject } = Promise.withResolvers<string>();
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const size = Math.min(img.width, img.height);
      const offsetX = (img.width - size) / 2;
      const offsetY = (img.height - size) / 2;
      canvas.width = MAX_PROFILE_PHOTO_SIZE;
      canvas.height = MAX_PROFILE_PHOTO_SIZE;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, offsetX, offsetY, size, size, 0, 0, MAX_PROFILE_PHOTO_SIZE, MAX_PROFILE_PHOTO_SIZE);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = reader.result as string;
  };
  reader.onerror = reject;
  reader.readAsDataURL(file);
  return promise;
}
