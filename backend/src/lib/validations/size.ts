import sharp from 'sharp';

const MIN_DIMENSION = 300;
const MIN_FILE_SIZE = 50 * 1024;

export async function checkSize(
  buffer: Buffer
): Promise<{ passed: boolean; reason?: string; width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return {
      passed: false,
      reason: 'Image resolution too small (minimum 300×300px)',
      width,
      height,
    };
  }

  if (buffer.length < MIN_FILE_SIZE) {
    return {
      passed: false,
      reason: 'Image file size too small (minimum 50KB)',
      width,
      height,
    };
  }

  return { passed: true, width, height };
}
