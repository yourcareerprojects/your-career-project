/**
 * Creates a cropped image from the provided image source
 * @param {string} imageSrc - Source URL or data URL of the image
 * @param {Object} pixelCrop - Crop area in pixels { x, y, width, height }
 * @param {number} rotation - Rotation angle in degrees (default: 0)
 * @returns {Promise<Blob>} - Promise that resolves to a Blob of the cropped image
 */
export const createImage = (url) =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', (error) => reject(error));
    image.src = url;
  });

export const getCroppedImg = async (imageSrc, pixelCrop, rotation = 0) => {
  // Validate inputs
  if (!imageSrc) {
    throw new Error('Image source is required');
  }
  
  if (!pixelCrop || !pixelCrop.width || !pixelCrop.height || pixelCrop.width <= 0 || pixelCrop.height <= 0) {
    throw new Error('Invalid crop area');
  }

  const image = await createImage(imageSrc);
  
  // Validate image loaded successfully
  if (!image.width || !image.height) {
    throw new Error('Image failed to load');
  }

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('No 2d context');
  }

  const maxSize = Math.max(image.width, image.height);
  const safeArea = 2 * ((maxSize / 2) * Math.sqrt(2));

  // Set canvas dimensions to safe area
  canvas.width = safeArea;
  canvas.height = safeArea;

  // Translate canvas context to center
  ctx.translate(safeArea / 2, safeArea / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-safeArea / 2, -safeArea / 2);

  // Draw rotated image
  ctx.drawImage(
    image,
    safeArea / 2 - image.width * 0.5,
    safeArea / 2 - image.height * 0.5
  );

  const data = ctx.getImageData(0, 0, safeArea, safeArea);

  // Validate crop dimensions
  const cropWidth = Math.max(1, Math.min(pixelCrop.width, image.width));
  const cropHeight = Math.max(1, Math.min(pixelCrop.height, image.height));

  // Set canvas dimensions to final crop size
  canvas.width = cropWidth;
  canvas.height = cropHeight;

  // Paste rotated image at the center of the canvas
  ctx.putImageData(
    data,
    Math.round(0 - safeArea / 2 + image.width * 0.5 - pixelCrop.x),
    Math.round(0 - safeArea / 2 + image.height * 0.5 - pixelCrop.y)
  );

  // Convert canvas to blob
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('Canvas is empty - failed to create image blob'));
        return;
      }
      resolve(blob);
    }, 'image/jpeg', 0.9); // 90% quality
  });
};

