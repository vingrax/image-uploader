import sharp from 'sharp';
import { checkSize } from '../size';

async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 128, g: 128, b: 128 } },
  })
    .jpeg({ quality: 100 })
    .toBuffer();
}

describe('checkSize', () => {
  it('rejects image narrower than 300px', async () => {
    const buf = await makeJpeg(200, 400);
    const result = await checkSize(buf);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/resolution/i);
    expect(result.width).toBe(200);
  });

  it('rejects image shorter than 300px', async () => {
    const buf = await makeJpeg(400, 200);
    const result = await checkSize(buf);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/resolution/i);
    expect(result.height).toBe(200);
  });

  it('rejects image under 50KB', async () => {
    // A 300x300 solid-color JPEG at quality 100 is ~15KB — below 50KB threshold
    const buf = await makeJpeg(300, 300);
    expect(buf.length).toBeLessThan(50 * 1024);
    const result = await checkSize(buf);
    expect(result.passed).toBe(false);
    expect(result.reason).toMatch(/file size/i);
  });

  it('returns width and height on rejection', async () => {
    const buf = await makeJpeg(150, 150);
    const result = await checkSize(buf);
    expect(result.width).toBe(150);
    expect(result.height).toBe(150);
  });
});
