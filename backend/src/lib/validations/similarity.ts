import sharp from 'sharp';
import prisma from '../prisma';

const SIMILARITY_THRESHOLD = 10;

export async function computeDHash(buffer: Buffer): Promise<string> {
  const { data } = await sharp(buffer)
    .resize(9, 8, { fit: 'fill' })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let hash = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      hash += data[row * 9 + col] < data[row * 9 + col + 1] ? '1' : '0';
    }
  }
  return hash;
}

export function hammingDistance(a: string, b: string): number {
  let distance = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] !== b[i]) distance++;
  }
  return distance;
}

export async function checkSimilarity(
  buffer: Buffer,
  currentImageId: string
): Promise<{ passed: boolean; reason?: string; pHash: string }> {
  const pHash = await computeDHash(buffer);

  const accepted = await prisma.image.findMany({
    where: { status: 'ACCEPTED', id: { not: currentImageId } },
    select: { pHash: true },
  });

  for (const img of accepted) {
    if (!img.pHash) continue;
    if (hammingDistance(pHash, img.pHash) < SIMILARITY_THRESHOLD) {
      return { passed: false, reason: 'Too similar to an existing image', pHash };
    }
  }

  return { passed: true, pHash };
}
