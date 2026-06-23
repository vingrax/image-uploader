import sharp from 'sharp';
import { checkBlur } from '../blur';

describe('checkBlur', () => {
  it('rejects a solid-color image (no edges → score near 0)', async () => {
    const buf = await sharp({
      create: { width: 400, height: 400, channels: 3, background: { r: 128, g: 128, b: 128 } },
    })
      .jpeg()
      .toBuffer();
    const result = await checkBlur(buf);
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(100);
    expect(result.reason).toMatch(/blurry/i);
  });

  it('accepts a high-contrast checkerboard (many edges → high score)', async () => {
    const size = 400;
    const pixels = Buffer.alloc(size * size * 3);
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 3;
        const val = (x + y) % 2 === 0 ? 255 : 0;
        pixels[i] = val;
        pixels[i + 1] = val;
        pixels[i + 2] = val;
      }
    }
    const buf = await sharp(pixels, {
      raw: { width: size, height: size, channels: 3 },
    })
      .jpeg({ quality: 100 })
      .toBuffer();
    const result = await checkBlur(buf);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThan(100);
  });
});
