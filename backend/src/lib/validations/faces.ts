import type * as FaceApi from '@vladmandic/face-api';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const faceapi = require('@vladmandic/face-api/dist/face-api.node-wasm.js') as typeof FaceApi;
import sharp from 'sharp';
import path from 'path';

const MODEL_PATH = path.join(
  __dirname,
  '../../../node_modules/@vladmandic/face-api/model'
);
const FACE_AREA_THRESHOLD = 0.10;

let loadPromise: Promise<void> | null = null;

export function loadFaceModels(): Promise<void> {
  if (!loadPromise) loadPromise = _doLoad();
  return loadPromise;
}

async function _doLoad(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (faceapi.tf as any).ready();
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
}

export async function checkFaces(
  jpegBuffer: Buffer,
  imageWidth: number,
  imageHeight: number
): Promise<{ passed: boolean; reason?: string; faceCount: number }> {
  const { data, info } = await sharp(jpegBuffer)
    .resize({ width: 640, withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const tensor = faceapi.tf.tensor3d(new Uint8Array(data), [info.height, info.width, info.channels as 3]);

  let detections: Array<{ box: { width: number; height: number } }>;
  try {
    detections = await faceapi
      .detectAllFaces(
        tensor as unknown as FaceApi.TNetInput,
        new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 })
      )
      .run();
  } finally {
    tensor.dispose();
  }

  const faceCount = detections.length;

  if (faceCount === 0) {
    return { passed: false, reason: 'No face detected', faceCount };
  }

  if (faceCount > 1) {
    return { passed: false, reason: 'Multiple faces detected', faceCount };
  }

  const { box } = detections[0];
  const ratio = (box.width * box.height) / (info.width * info.height);

  if (ratio < FACE_AREA_THRESHOLD) {
    return { passed: false, reason: 'Face too small in the image', faceCount };
  }

  return { passed: true, faceCount };
}
