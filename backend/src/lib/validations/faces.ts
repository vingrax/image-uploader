import '@tensorflow/tfjs'; // register CPU backend
import * as faceapi from '@vladmandic/face-api';
import sharp from 'sharp';
import path from 'path';

const MODEL_PATH = path.join(
  __dirname,
  '../../../../node_modules/@vladmandic/face-api/model'
);
const FACE_AREA_THRESHOLD = 0.10;

let modelsLoaded = false;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  await faceapi.nets.ssdMobilenetv1.loadFromDisk(MODEL_PATH);
  modelsLoaded = true;
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
        tensor as unknown as faceapi.TNetInput,
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
