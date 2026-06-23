import sharp from 'sharp';
import { computeDHash, hammingDistance } from '../similarity';

async function makeColorJpeg(r: number, g: number, b: number): Promise<Buffer> {
  return sharp({
    create: { width: 300, height: 300, channels: 3, background: { r, g, b } },
  })
    .jpeg()
    .toBuffer();
}

describe('computeDHash', () => {
  it('returns a 64-char binary string', async () => {
    const hash = await computeDHash(await makeColorJpeg(100, 100, 100));
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[01]+$/);
  });

  it('returns the same hash for the same buffer', async () => {
    const buf = await makeColorJpeg(80, 120, 200);
    expect(await computeDHash(buf)).toBe(await computeDHash(buf));
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(hammingDistance('01010101', '01010101')).toBe(0);
  });

  it('counts differing positions', () => {
    expect(hammingDistance('0000', '1111')).toBe(4);
    expect(hammingDistance('0101', '0100')).toBe(1);
  });
});
