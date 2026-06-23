jest.mock('@tensorflow/tfjs', () => ({}));

jest.mock('sharp', () => {
  return jest.fn().mockReturnValue({
    resize: jest.fn().mockReturnThis(),
    raw: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue({
      data: Buffer.alloc(640 * 480 * 3),
      info: { width: 640, height: 480, channels: 3 },
    }),
  });
});

jest.mock('@vladmandic/face-api', () => ({
  nets: { ssdMobilenetv1: { loadFromDisk: jest.fn().mockResolvedValue(undefined) } },
  detectAllFaces: jest.fn(),
  SsdMobilenetv1Options: jest.fn().mockImplementation(() => ({})),
  tf: {
    tensor3d: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  },
}));

import * as faceapi from '@vladmandic/face-api';
import { checkFaces } from '../faces';

const mockDetect = faceapi.detectAllFaces as jest.Mock;
const FAKE = Buffer.from('x');

function mockFaces(boxes: { width: number; height: number }[]) {
  mockDetect.mockReturnValue({
    run: jest.fn().mockResolvedValue(
      boxes.map((b) => ({ box: { x: 0, y: 0, ...b } }))
    ),
  });
}

describe('checkFaces', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects when no faces detected', async () => {
    mockFaces([]);
    const r = await checkFaces(FAKE, 400, 400);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/no face/i);
    expect(r.faceCount).toBe(0);
  });

  it('rejects when multiple faces detected', async () => {
    mockFaces([{ width: 200, height: 200 }, { width: 200, height: 200 }]);
    const r = await checkFaces(FAKE, 400, 400);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/multiple/i);
  });

  it('rejects when face area is less than 10% of image', async () => {
    // 20×20 = 400px² / (400×400=160000px²) = 0.0025 < 0.10
    mockFaces([{ width: 20, height: 20 }]);
    const r = await checkFaces(FAKE, 400, 400);
    expect(r.passed).toBe(false);
    expect(r.reason).toMatch(/too small/i);
  });

  it('accepts one adequately-sized face', async () => {
    // 250×250 = 62500px² / 160000px² = 0.39 > 0.10
    mockFaces([{ width: 250, height: 250 }]);
    const r = await checkFaces(FAKE, 400, 400);
    expect(r.passed).toBe(true);
    expect(r.faceCount).toBe(1);
  });
});
