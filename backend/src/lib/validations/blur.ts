import sharp from 'sharp';

const BLUR_THRESHOLD = 100;

export async function checkBlur(
  buffer: Buffer
): Promise<{ passed: boolean; reason?: string; score: number }> {
  const { data, info } = await sharp(buffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  let sumSq = 0;
  let count = 0;

  // 3×3 Laplacian kernel (center=-4, cardinal neighbors=+1)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        data[idx - width] +
        data[idx + width] +
        data[idx - 1] +
        data[idx + 1] -
        4 * data[idx];
      sumSq += lap * lap;
      count++;
    }
  }

  const score = count > 0 ? sumSq / count : 0;

  if (score < BLUR_THRESHOLD) {
    return { passed: false, reason: 'Image is too blurry', score };
  }

  return { passed: true, score };
}
