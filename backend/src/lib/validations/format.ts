import sharp from 'sharp';

export async function convertToJpeg(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType === 'image/heic') {
    return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  }
  return buffer;
}
