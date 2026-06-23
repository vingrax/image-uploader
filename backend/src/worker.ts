import 'dotenv/config';
import { Worker } from 'bullmq';
import axios from 'axios';
import { connection, type ImageJobData } from './queue';
import prisma from './lib/prisma';
import { convertToJpeg } from './lib/validations/format';
import { checkSize } from './lib/validations/size';
import { checkBlur } from './lib/validations/blur';
import { checkSimilarity } from './lib/validations/similarity';
import { checkFaces, loadFaceModels } from './lib/validations/faces';

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await axios.get<ArrayBuffer>(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

async function processImage(data: ImageJobData): Promise<void> {
  const { imageId, cloudinaryUrl, mimeType } = data;

  try {
    const raw = await fetchBuffer(cloudinaryUrl);
    const buffer = await convertToJpeg(raw, mimeType);

    const sizeResult = await checkSize(buffer, data.fileSize);
    if (!sizeResult.passed) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: sizeResult.reason, width: sizeResult.width, height: sizeResult.height },
      });
      return;
    }

    const blurResult = await checkBlur(buffer);
    if (!blurResult.passed) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: blurResult.reason, blurScore: blurResult.score, width: sizeResult.width, height: sizeResult.height },
      });
      return;
    }

    const simResult = await checkSimilarity(buffer, imageId);
    if (!simResult.passed) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: simResult.reason, pHash: simResult.pHash, width: sizeResult.width, height: sizeResult.height },
      });
      return;
    }

    const faceResult = await checkFaces(buffer, sizeResult.width, sizeResult.height);
    if (!faceResult.passed) {
      await prisma.image.update({
        where: { id: imageId },
        data: { status: 'REJECTED', rejectionReason: faceResult.reason, faceCount: faceResult.faceCount, pHash: simResult.pHash, width: sizeResult.width, height: sizeResult.height },
      });
      return;
    }

    await prisma.image.update({
      where: { id: imageId },
      data: {
        status: 'ACCEPTED',
        width: sizeResult.width,
        height: sizeResult.height,
        blurScore: blurResult.score,
        pHash: simResult.pHash,
        faceCount: faceResult.faceCount,
      },
    });
  } catch (err) {
    console.error(`Worker error for ${imageId}:`, err);
    await prisma.image.update({
      where: { id: imageId },
      data: { status: 'REJECTED', rejectionReason: 'Processing failed unexpectedly' },
    });
  }
}

async function start(): Promise<void> {
  console.log('Loading face detection models...');
  await loadFaceModels();
  console.log('Models loaded. Worker ready.');

  const worker = new Worker<ImageJobData>(
    'image-processing',
    async (job) => {
      console.log(`Processing image ${job.data.imageId}`);
      await processImage(job.data);
      console.log(`Done: ${job.data.imageId}`);
    },
    { connection, concurrency: 2 }
  );

  worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err));
}

start().catch(console.error);
