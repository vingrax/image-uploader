import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const connection = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

export const imageQueue = new Queue('image-processing', { connection });

export type ImageJobData = {
  imageId: string;
  cloudinaryUrl: string;
  cloudinaryPublicId: string;
  mimeType: string;
  fileSize: number;
};
