# Image Uploader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a full-stack image upload platform with 6 async validation rules (format, size, blur, similarity, faces) processed via BullMQ, stored in PostgreSQL/Cloudinary, with a React frontend that polls for results.

**Architecture:** React frontend uploads to Express API → file stored on Cloudinary → job enqueued in BullMQ/Redis → worker validates in sequence (fail-fast) → DB updated → frontend polls `GET /api/images/:id` every 2s until status resolves to ACCEPTED or REJECTED.

**Tech Stack:** React 18 + Vite + TypeScript, Node.js 18 + Express 4 + TypeScript, PostgreSQL 16 + Prisma 5, BullMQ 4 + Redis 7, sharp 0.32, @vladmandic/face-api + @tensorflow/tfjs-node, Cloudinary v2 SDK, axios, docker-compose

## Global Constraints

- Node.js >= 18 required
- TypeScript `strict: true` for both frontend and backend
- All file I/O is in-memory — multer uses `memoryStorage()`, images go directly to Cloudinary, no local disk writes
- HEIC converted to JPEG via sharp before any downstream validation
- pHash (dHash) similarity compared only against ACCEPTED images in DB
- Thresholds: blur mean-squared-Laplacian < 100 → reject; Hamming distance < 10 → reject; face area < 10% of image area → reject; file < 50KB OR dimension < 300px → reject
- Worker loads face-api.js SSD MobileNetV1 models once at startup from `node_modules/@vladmandic/face-api/model`
- Backend port: 3001; Frontend dev server: 5173 with `/api` proxy to 3001
- Do NOT commit `docs/`, plan files, or spec files to git

---

## File Map

```
image-uploader/
├── docker-compose.yml
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── jest.config.js
│   ├── .env  /  .env.example
│   ├── prisma/schema.prisma
│   └── src/
│       ├── server.ts                        # Express app + route mounting
│       ├── queue.ts                         # BullMQ Queue + ImageJobData type
│       ├── worker.ts                        # BullMQ Worker — orchestrates pipeline
│       ├── lib/
│       │   ├── prisma.ts                    # PrismaClient singleton
│       │   ├── cloudinary.ts               # upload + delete helpers
│       │   └── validations/
│       │       ├── format.ts               # HEIC → JPEG conversion
│       │       ├── size.ts                 # min size + resolution check
│       │       ├── blur.ts                 # Laplacian variance blur detection
│       │       ├── similarity.ts           # dHash + Hamming distance
│       │       ├── faces.ts                # face-api.js face count + size check
│       │       └── __tests__/
│       │           ├── size.test.ts
│       │           ├── blur.test.ts
│       │           ├── similarity.test.ts
│       │           └── faces.test.ts
│       └── routes/
│           └── images.ts                   # POST/GET/DELETE /api/images
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── types.ts
│       ├── api.ts
│       ├── components/
│       │   ├── Uploader.tsx               # drag-drop + HEIC modal
│       │   ├── ImageCard.tsx              # thumbnail + status badge
│       │   └── ImageGrid.tsx              # accepted/rejected columns
│       └── hooks/
│           └── useImageUpload.ts          # upload + polling state
```

---

### Task 1: Infrastructure & Backend Scaffold

**Files:**
- Create: `docker-compose.yml`
- Create: `backend/package.json`
- Create: `backend/tsconfig.json`
- Create: `backend/jest.config.js`
- Create: `backend/prisma/schema.prisma`
- Create: `backend/.env.example`
- Create: `backend/.env`

**Interfaces:**
- Produces: PostgreSQL on 5432, Redis on 6379; `Image` Prisma model; compiled TypeScript via `tsx`

- [ ] **Step 1: Create `docker-compose.yml` in project root**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: image_uploader
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

- [ ] **Step 2: Create `backend/package.json`**

```json
{
  "name": "image-uploader-backend",
  "version": "1.0.0",
  "scripts": {
    "dev": "tsx watch src/server.ts",
    "worker": "tsx src/worker.ts",
    "build": "tsc",
    "db:migrate": "prisma migrate dev",
    "db:generate": "prisma generate",
    "test": "jest --runInBand"
  },
  "dependencies": {
    "@prisma/client": "^5.6.0",
    "@tensorflow/tfjs-node": "^4.13.0",
    "@vladmandic/face-api": "^1.7.13",
    "axios": "^1.6.0",
    "bullmq": "^4.14.0",
    "cloudinary": "^2.0.1",
    "cors": "^2.8.5",
    "dotenv": "^16.3.1",
    "express": "^4.18.2",
    "ioredis": "^5.3.2",
    "multer": "^1.4.5-lts.1",
    "sharp": "^0.32.6"
  },
  "devDependencies": {
    "@types/cors": "^2.8.14",
    "@types/express": "^4.17.21",
    "@types/jest": "^29.5.8",
    "@types/multer": "^1.4.9",
    "@types/node": "^20.9.0",
    "jest": "^29.7.0",
    "prisma": "^5.6.0",
    "ts-jest": "^29.1.1",
    "tsx": "^4.3.0",
    "typescript": "^5.2.2"
  }
}
```

- [ ] **Step 3: Create `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "moduleResolution": "node"
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 4: Create `backend/jest.config.js`**

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
};
```

- [ ] **Step 5: Create `backend/prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Image {
  id                 String      @id @default(cuid())
  originalName       String
  mimeType           String
  fileSize           Int
  width              Int?
  height             Int?
  cloudinaryUrl      String
  cloudinaryPublicId String
  status             ImageStatus @default(PROCESSING)
  rejectionReason    String?
  pHash              String?
  blurScore          Float?
  faceCount          Int?
  createdAt          DateTime    @default(now())
  updatedAt          DateTime    @updatedAt
}

enum ImageStatus {
  PROCESSING
  ACCEPTED
  REJECTED
}
```

- [ ] **Step 6: Create `backend/.env.example` and `backend/.env`**

`.env.example`:
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/image_uploader
REDIS_URL=redis://localhost:6379
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
PORT=3001
```

`.env` — copy `.env.example` then fill in Cloudinary values from your dashboard.

- [ ] **Step 7: Start infrastructure and install dependencies**

```bash
# From project root
docker-compose up -d

# From backend/
npm install
npx prisma migrate dev --name init
```

Expected: Postgres and Redis containers running. `backend/prisma/migrations/` created. Prisma client generated.

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml backend/package.json backend/tsconfig.json backend/jest.config.js backend/prisma/ backend/.env.example
git commit -m "feat: infrastructure setup with docker-compose and prisma schema"
```

---

### Task 2: Express Server + Cloudinary + Prisma Clients

**Files:**
- Create: `backend/src/lib/prisma.ts`
- Create: `backend/src/lib/cloudinary.ts`
- Create: `backend/src/server.ts`

**Interfaces:**
- Produces: `prisma` (PrismaClient singleton); `uploadToCloudinary(buffer: Buffer, originalName: string): Promise<{ url: string; publicId: string }>`; `deleteFromCloudinary(publicId: string): Promise<void>`; Express app on PORT with `GET /health → { status: 'ok' }`

- [ ] **Step 1: Create `backend/src/lib/prisma.ts`**

```typescript
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export default prisma;
```

- [ ] **Step 2: Create `backend/src/lib/cloudinary.ts`**

```typescript
import { v2 as cloudinary } from 'cloudinary';
import { Readable } from 'stream';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export async function uploadToCloudinary(
  buffer: Buffer,
  originalName: string
): Promise<{ url: string; publicId: string }> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: 'image-uploader',
        public_id: `${Date.now()}-${originalName.replace(/\.[^.]+$/, '')}`,
        resource_type: 'image',
      },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error('Upload failed'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      }
    );
    Readable.from(buffer).pipe(stream);
  });
}

export async function deleteFromCloudinary(publicId: string): Promise<void> {
  await cloudinary.uploader.destroy(publicId);
}
```

- [ ] **Step 3: Create `backend/src/server.ts`**

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
```

- [ ] **Step 4: Verify server starts**

```bash
cd backend && npm run dev
# Then in another terminal:
curl http://localhost:3001/health
```

Expected: `{"status":"ok"}`

- [ ] **Step 5: Commit**

```bash
git add backend/src/
git commit -m "feat: express server with cloudinary and prisma clients"
```

---

### Task 3: Image Routes + BullMQ Queue

**Files:**
- Create: `backend/src/queue.ts`
- Create: `backend/src/routes/images.ts`
- Modify: `backend/src/server.ts`

**Interfaces:**
- Consumes: `uploadToCloudinary`, `deleteFromCloudinary`; `prisma`
- Produces: `imageQueue` (BullMQ Queue `'image-processing'`); `ImageJobData` type; `connection` (IORedis);
  - `POST /api/images` → `201 { id, originalName, cloudinaryUrl, status: "PROCESSING", ... }`
  - `GET /api/images` → `200 Image[]` ordered by `createdAt desc`
  - `GET /api/images/:id` → `200 Image | 404`
  - `DELETE /api/images/:id` → `200 { success: true } | 404`

- [ ] **Step 1: Create `backend/src/queue.ts`**

```typescript
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
```

- [ ] **Step 2: Create `backend/src/routes/images.ts`**

```typescript
import { Router } from 'express';
import multer from 'multer';
import prisma from '../lib/prisma';
import { uploadToCloudinary, deleteFromCloudinary } from '../lib/cloudinary';
import { imageQueue } from '../queue';

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/heic'];
    cb(null, allowed.includes(file.mimetype));
  },
});

router.post('/', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No valid image file provided' });

  const { buffer, originalname, mimetype, size } = req.file;
  const { url, publicId } = await uploadToCloudinary(buffer, originalname);

  const image = await prisma.image.create({
    data: {
      originalName: originalname,
      mimeType: mimetype,
      fileSize: size,
      cloudinaryUrl: url,
      cloudinaryPublicId: publicId,
    },
  });

  await imageQueue.add('process', {
    imageId: image.id,
    cloudinaryUrl: url,
    cloudinaryPublicId: publicId,
    mimeType: mimetype,
    fileSize: size,
  });

  res.status(201).json(image);
});

router.get('/', async (_req, res) => {
  const images = await prisma.image.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(images);
});

router.get('/:id', async (req, res) => {
  const image = await prisma.image.findUnique({ where: { id: req.params.id } });
  if (!image) return res.status(404).json({ error: 'Not found' });
  res.json(image);
});

router.delete('/:id', async (req, res) => {
  const image = await prisma.image.findUnique({ where: { id: req.params.id } });
  if (!image) return res.status(404).json({ error: 'Not found' });

  await deleteFromCloudinary(image.cloudinaryPublicId);
  await prisma.image.delete({ where: { id: req.params.id } });

  res.json({ success: true });
});

export default router;
```

- [ ] **Step 3: Mount routes in `backend/src/server.ts`**

Add after the cors/json middleware lines, before `app.listen`:

```typescript
import imagesRouter from './routes/images';
// ...
app.use('/api/images', imagesRouter);
```

Full updated `backend/src/server.ts`:

```typescript
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import imagesRouter from './routes/images';

const app = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/images', imagesRouter);

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
```

- [ ] **Step 4: Test upload endpoint**

```bash
# With server running (npm run dev):
curl -X POST http://localhost:3001/api/images \
  -F "image=@C:/path/to/any_photo.jpg"
```

Expected: `201` with `{ "id": "...", "status": "PROCESSING", "cloudinaryUrl": "https://res.cloudinary.com/..." }`

- [ ] **Step 5: Commit**

```bash
git add backend/src/queue.ts backend/src/routes/images.ts backend/src/server.ts
git commit -m "feat: image upload route with cloudinary storage and bullmq queue"
```

---

### Task 4: Validation — Format (HEIC) & Size

**Files:**
- Create: `backend/src/lib/validations/format.ts`
- Create: `backend/src/lib/validations/size.ts`
- Create: `backend/src/lib/validations/__tests__/size.test.ts`

**Interfaces:**
- Produces:
  - `convertToJpeg(buffer: Buffer, mimeType: string): Promise<Buffer>` — converts HEIC to JPEG at quality 90; returns buffer unchanged for JPEG/PNG
  - `checkSize(buffer: Buffer): Promise<{ passed: boolean; reason?: string; width: number; height: number }>` — rejects if width < 300 OR height < 300; rejects if buffer.length < 51200

- [ ] **Step 1: Create `backend/src/lib/validations/format.ts`**

```typescript
import sharp from 'sharp';

export async function convertToJpeg(buffer: Buffer, mimeType: string): Promise<Buffer> {
  if (mimeType === 'image/heic') {
    return sharp(buffer).jpeg({ quality: 90 }).toBuffer();
  }
  return buffer;
}
```

- [ ] **Step 2: Write failing size test**

Create `backend/src/lib/validations/__tests__/size.test.ts`:

```typescript
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
```

Run: `cd backend && npx jest size.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '../size'`

- [ ] **Step 3: Implement `backend/src/lib/validations/size.ts`**

```typescript
import sharp from 'sharp';

const MIN_DIMENSION = 300;
const MIN_FILE_SIZE = 50 * 1024;

export async function checkSize(
  buffer: Buffer
): Promise<{ passed: boolean; reason?: string; width: number; height: number }> {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;

  if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
    return {
      passed: false,
      reason: 'Image resolution too small (minimum 300×300px)',
      width,
      height,
    };
  }

  if (buffer.length < MIN_FILE_SIZE) {
    return {
      passed: false,
      reason: 'Image file size too small (minimum 50KB)',
      width,
      height,
    };
  }

  return { passed: true, width, height };
}
```

- [ ] **Step 4: Run tests**

```bash
cd backend && npx jest size.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/src/lib/validations/format.ts backend/src/lib/validations/size.ts backend/src/lib/validations/__tests__/size.test.ts
git commit -m "feat: heic format conversion and size/resolution validation"
```

---

### Task 5: Validation — Blur Detection

**Files:**
- Create: `backend/src/lib/validations/blur.ts`
- Create: `backend/src/lib/validations/__tests__/blur.test.ts`

**Interfaces:**
- Produces: `checkBlur(buffer: Buffer): Promise<{ passed: boolean; reason?: string; score: number }>` — computes mean-squared Laplacian via raw pixel buffer; score < 100 → reject "Image is too blurry"

- [ ] **Step 1: Write failing blur test**

Create `backend/src/lib/validations/__tests__/blur.test.ts`:

```typescript
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
```

Run: `cd backend && npx jest blur.test.ts --no-coverage`
Expected: FAIL — `Cannot find module '../blur'`

- [ ] **Step 2: Implement `backend/src/lib/validations/blur.ts`**

```typescript
import sharp from 'sharp';

const BLUR_THRESHOLD = 100;

export async function checkBlur(
  buffer: Buffer
): Promise<{ passed: boolean; reason?: string; score: number }> {
  const { data, info } = await sharp(buffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height } = info;
  let sumSq = 0;
  let count = 0;

  // 3×3 Laplacian kernel (center=-4, cardinal neighbors=+1)
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap =
        data[idx - width] +
        data[idx + width] +
        data[idx - 1] +
        data[idx + 1] -
        4 * data[idx];
      sumSq += lap * lap;
      count++;
    }
  }

  const score = count > 0 ? sumSq / count : 0;

  if (score < BLUR_THRESHOLD) {
    return { passed: false, reason: 'Image is too blurry', score };
  }

  return { passed: true, score };
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend && npx jest blur.test.ts --no-coverage
```

Expected: PASS (2 tests)

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/validations/blur.ts backend/src/lib/validations/__tests__/blur.test.ts
git commit -m "feat: blur detection via laplacian variance"
```

---

### Task 6: Validation — Similarity (dHash)

**Files:**
- Create: `backend/src/lib/validations/similarity.ts`
- Create: `backend/src/lib/validations/__tests__/similarity.test.ts`

**Interfaces:**
- Produces:
  - `computeDHash(buffer: Buffer): Promise<string>` — 64-char binary string (9×8 grayscale difference hash)
  - `hammingDistance(a: string, b: string): number` — count of differing bit positions
  - `checkSimilarity(buffer: Buffer, currentImageId: string): Promise<{ passed: boolean; reason?: string; pHash: string }>` — queries DB ACCEPTED images, rejects if any Hamming distance < 10

- [ ] **Step 1: Write failing similarity tests**

Create `backend/src/lib/validations/__tests__/similarity.test.ts`:

```typescript
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
```

Run: `cd backend && npx jest similarity.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 2: Implement `backend/src/lib/validations/similarity.ts`**

```typescript
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
```

- [ ] **Step 3: Run tests**

```bash
cd backend && npx jest similarity.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/validations/similarity.ts backend/src/lib/validations/__tests__/similarity.test.ts
git commit -m "feat: similarity detection via dhash and hamming distance"
```

---

### Task 7: Validation — Face Detection

**Files:**
- Create: `backend/src/lib/validations/faces.ts`
- Create: `backend/src/lib/validations/__tests__/faces.test.ts`

**Interfaces:**
- Produces:
  - `loadFaceModels(): Promise<void>` — loads SSD MobileNetV1 from `@vladmandic/face-api/model`; idempotent (no-op if already loaded)
  - `checkFaces(jpegBuffer: Buffer, imageWidth: number, imageHeight: number): Promise<{ passed: boolean; reason?: string; faceCount: number }>` — 0 faces → reject; >1 → reject; face area < 10% → reject

- [ ] **Step 1: Write failing face tests**

Create `backend/src/lib/validations/__tests__/faces.test.ts`:

```typescript
jest.mock('@tensorflow/tfjs-node', () => ({
  node: {
    decodeImage: jest.fn().mockReturnValue({ dispose: jest.fn() }),
  },
}));

jest.mock('@vladmandic/face-api', () => ({
  nets: { ssdMobilenetv1: { loadFromDisk: jest.fn().mockResolvedValue(undefined) } },
  detectAllFaces: jest.fn(),
  SsdMobilenetv1Options: jest.fn().mockImplementation(() => ({})),
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
```

Run: `cd backend && npx jest faces.test.ts --no-coverage`
Expected: FAIL

- [ ] **Step 2: Implement `backend/src/lib/validations/faces.ts`**

```typescript
import * as tf from '@tensorflow/tfjs-node';
import * as faceapi from '@vladmandic/face-api';
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
  const tensor = tf.node.decodeImage(jpegBuffer, 3) as tf.Tensor3D;

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
  const ratio = (box.width * box.height) / (imageWidth * imageHeight);

  if (ratio < FACE_AREA_THRESHOLD) {
    return { passed: false, reason: 'Face too small in the image', faceCount };
  }

  return { passed: true, faceCount };
}
```

- [ ] **Step 3: Run tests**

```bash
cd backend && npx jest faces.test.ts --no-coverage
```

Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add backend/src/lib/validations/faces.ts backend/src/lib/validations/__tests__/faces.test.ts
git commit -m "feat: face detection validation with vladmandic/face-api"
```

---

### Task 8: Worker — Wire Validation Pipeline

**Files:**
- Create: `backend/src/worker.ts`

**Interfaces:**
- Consumes: `convertToJpeg` (format.ts); `checkSize` (size.ts); `checkBlur` (blur.ts); `checkSimilarity` (similarity.ts); `checkFaces`, `loadFaceModels` (faces.ts); `imageQueue`, `ImageJobData`, `connection` (queue.ts); `prisma` (lib/prisma.ts)
- Produces: BullMQ Worker consuming `'image-processing'` queue; updates DB to `ACCEPTED` or `REJECTED` with reason on every job; logs progress to console

- [ ] **Step 1: Create `backend/src/worker.ts`**

```typescript
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

    const sizeResult = await checkSize(buffer);
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
```

- [ ] **Step 2: End-to-end test**

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd backend && npm run worker
# Wait for "Models loaded. Worker ready."

# Terminal 3 — upload a photo with a clear face
curl -X POST http://localhost:3001/api/images -F "image=@C:/path/to/face.jpg"
# Copy the returned id

# Poll until resolved
curl http://localhost:3001/api/images/<id>
```

Expected: Status changes from `PROCESSING` → `ACCEPTED` or `REJECTED` with a reason within 5-15 seconds.

- [ ] **Step 3: Commit**

```bash
git add backend/src/worker.ts
git commit -m "feat: bullmq worker with full validation pipeline"
```

---

### Task 9: Frontend Scaffold + API Client

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/index.html`
- Create: `frontend/src/types.ts`
- Create: `frontend/src/api.ts`
- Create: `frontend/src/main.tsx`

**Interfaces:**
- Produces: `ImageRecord` type; `uploadImage(file: File): Promise<ImageRecord>`; `pollImage(id: string): Promise<ImageRecord>`; `listImages(): Promise<ImageRecord[]>`; `deleteImage(id: string): Promise<void>`; Vite dev server on 5173 proxying `/api` → 3001

- [ ] **Step 1: Create `frontend/package.json`**

```json
{
  "name": "image-uploader-frontend",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.2.38",
    "@types/react-dom": "^18.2.17",
    "@vitejs/plugin-react": "^4.2.0",
    "typescript": "^5.2.2",
    "vite": "^5.0.0"
  }
}
```

- [ ] **Step 2: Create `frontend/vite.config.ts`**

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
```

- [ ] **Step 3: Create `frontend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Image Uploader</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 5: Create `frontend/src/types.ts`**

```typescript
export type ImageStatus = 'PROCESSING' | 'ACCEPTED' | 'REJECTED';

export interface ImageRecord {
  id: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  width: number | null;
  height: number | null;
  cloudinaryUrl: string;
  status: ImageStatus;
  rejectionReason: string | null;
  createdAt: string;
}
```

- [ ] **Step 6: Create `frontend/src/api.ts`**

```typescript
import type { ImageRecord } from './types';

const BASE = '/api/images';

export async function uploadImage(file: File): Promise<ImageRecord> {
  const form = new FormData();
  form.append('image', file);
  const res = await fetch(BASE, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

export async function pollImage(id: string): Promise<ImageRecord> {
  const res = await fetch(`${BASE}/${id}`);
  if (!res.ok) throw new Error('Poll failed');
  return res.json();
}

export async function listImages(): Promise<ImageRecord[]> {
  const res = await fetch(BASE);
  if (!res.ok) throw new Error('List failed');
  return res.json();
}

export async function deleteImage(id: string): Promise<void> {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Delete failed');
}
```

- [ ] **Step 7: Create `frontend/src/main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 8: Install and verify dev server**

```bash
cd frontend && npm install && npm run dev
```

Expected: Vite dev server running at http://localhost:5173 (will error until App.tsx is created — that is fine)

- [ ] **Step 9: Commit**

```bash
git add frontend/
git commit -m "feat: frontend scaffold with vite, typescript, and api client"
```

---

### Task 10: Uploader Component

**Files:**
- Create: `frontend/src/components/Uploader.tsx`

**Interfaces:**
- Consumes: `uploadImage` from `api.ts`; `ImageRecord` from `types.ts`
- Produces: `<Uploader onUploaded={(image: ImageRecord) => void} />` — drag-drop zone + file input; validates MIME type client-side; shows HEIC confirmation modal; calls `onUploaded` with the newly created `ImageRecord`

- [ ] **Step 1: Create `frontend/src/components/Uploader.tsx`**

```tsx
import React, { useRef, useState } from 'react';
import { uploadImage } from '../api';
import type { ImageRecord } from '../types';

interface Props {
  onUploaded: (image: ImageRecord) => void;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/heic'];

export default function Uploader({ onUploaded }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pendingHeic, setPendingHeic] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError('Only JPEG, PNG, and HEIC files are accepted.');
      return;
    }
    setError(null);
    if (file.type === 'image/heic') {
      setPendingHeic(file);
    } else {
      doUpload(file);
    }
  }

  async function doUpload(file: File) {
    setUploading(true);
    try {
      const image = await uploadImage(file);
      onUploaded(image);
    } catch {
      setError('Upload failed. Please try again.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <div>
      <div
        onDrop={(e) => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => !uploading && inputRef.current?.click()}
        style={{
          border: '2px dashed #d1d5db',
          borderRadius: 8,
          padding: '48px 24px',
          textAlign: 'center',
          cursor: uploading ? 'not-allowed' : 'pointer',
          background: '#f9fafb',
          color: '#6b7280',
        }}
      >
        {uploading
          ? 'Uploading...'
          : 'Drop an image here or click to select (JPEG, PNG, HEIC)'}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".jpg,.jpeg,.png,.heic,image/jpeg,image/png,image/heic"
        style={{ display: 'none' }}
        onChange={(e) => handleFiles(e.target.files)}
      />

      {error && <p style={{ color: '#ef4444', marginTop: 8, fontSize: 14 }}>{error}</p>}

      {pendingHeic && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100,
        }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 32, maxWidth: 400, width: '90%' }}>
            <h3 style={{ marginTop: 0, fontSize: 18 }}>Convert HEIC to JPEG?</h3>
            <p style={{ color: '#6b7280' }}>
              This image is in HEIC format and will be converted to JPEG on upload. Continue?
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                onClick={() => setPendingHeic(null)}
                style={{ padding: '8px 16px', borderRadius: 4, border: '1px solid #d1d5db', cursor: 'pointer', background: '#fff' }}
              >
                Cancel
              </button>
              <button
                onClick={() => { doUpload(pendingHeic); setPendingHeic(null); }}
                style={{ padding: '8px 16px', borderRadius: 4, border: 'none', background: '#2563eb', color: '#fff', cursor: 'pointer' }}
              >
                Convert & Upload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/Uploader.tsx
git commit -m "feat: uploader with drag-drop and heic conversion modal"
```

---

### Task 11: ImageCard + ImageGrid

**Files:**
- Create: `frontend/src/components/ImageCard.tsx`
- Create: `frontend/src/components/ImageGrid.tsx`

**Interfaces:**
- Consumes: `ImageRecord` from `types.ts`
- Produces:
  - `<ImageCard image={ImageRecord} onDelete={(id: string) => void} />`
  - `<ImageGrid images={ImageRecord[]} onDelete={(id: string) => void} />` — processing section at top; accepted/rejected in two columns below

- [ ] **Step 1: Create `frontend/src/components/ImageCard.tsx`**

```tsx
import type { ImageRecord } from '../types';

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  PROCESSING: { bg: '#fef3c7', color: '#d97706', label: 'Processing' },
  ACCEPTED:   { bg: '#d1fae5', color: '#059669', label: 'Accepted' },
  REJECTED:   { bg: '#fee2e2', color: '#dc2626', label: 'Rejected' },
};

interface Props {
  image: ImageRecord;
  onDelete: (id: string) => void;
}

export default function ImageCard({ image, onDelete }: Props) {
  const style = STATUS_STYLES[image.status];

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 8,
      overflow: 'hidden', background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    }}>
      <img
        src={image.cloudinaryUrl}
        alt={image.originalName}
        style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
      />
      <div style={{ padding: 12 }}>
        <p style={{
          margin: '0 0 8px', fontWeight: 500, fontSize: 13,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {image.originalName}
        </p>
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 12,
          fontSize: 12, fontWeight: 600, background: style.bg, color: style.color,
        }}>
          {style.label}
        </span>
        {image.rejectionReason && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6b7280' }}>
            {image.rejectionReason}
          </p>
        )}
        <button
          onClick={() => onDelete(image.id)}
          style={{
            marginTop: 8, padding: '3px 10px', fontSize: 12,
            background: 'transparent', border: '1px solid #e5e7eb',
            borderRadius: 4, cursor: 'pointer', color: '#9ca3af',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/ImageGrid.tsx`**

```tsx
import type React from 'react';
import type { ImageRecord } from '../types';
import ImageCard from './ImageCard';

interface Props {
  images: ImageRecord[];
  onDelete: (id: string) => void;
}

const grid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  gap: 16,
};

export default function ImageGrid({ images, onDelete }: Props) {
  const processing = images.filter((i) => i.status === 'PROCESSING');
  const accepted   = images.filter((i) => i.status === 'ACCEPTED');
  const rejected   = images.filter((i) => i.status === 'REJECTED');

  return (
    <div>
      {processing.length > 0 && (
        <section style={{ marginBottom: 32 }}>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#d97706' }}>
            Processing ({processing.length})
          </h2>
          <div style={grid}>
            {processing.map((img) => <ImageCard key={img.id} image={img} onDelete={onDelete} />)}
          </div>
        </section>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
        <section>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#059669' }}>
            Accepted ({accepted.length})
          </h2>
          <div style={grid}>
            {accepted.map((img) => <ImageCard key={img.id} image={img} onDelete={onDelete} />)}
          </div>
        </section>
        <section>
          <h2 style={{ margin: '0 0 16px', fontSize: 16, color: '#dc2626' }}>
            Rejected ({rejected.length})
          </h2>
          <div style={grid}>
            {rejected.map((img) => <ImageCard key={img.id} image={img} onDelete={onDelete} />)}
          </div>
        </section>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/
git commit -m "feat: image card and grid components"
```

---

### Task 12: useImageUpload Hook + App.tsx

**Files:**
- Create: `frontend/src/hooks/useImageUpload.ts`
- Create: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `listImages`, `pollImage`, `deleteImage` from `api.ts`; `ImageRecord` from `types.ts`
- Produces: `useImageUpload()` → `{ images: ImageRecord[], handleUploaded: (img: ImageRecord) => void, handleDelete: (id: string) => Promise<void> }`; `<App />` root component

- [ ] **Step 1: Create `frontend/src/hooks/useImageUpload.ts`**

```typescript
import { useState, useEffect, useRef } from 'react';
import type { ImageRecord } from '../types';
import { listImages, pollImage, deleteImage } from '../api';

export function useImageUpload() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const polls = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    listImages().then(setImages).catch(console.error);
    return () => polls.current.forEach(clearInterval);
  }, []);

  function startPolling(id: string) {
    const interval = setInterval(async () => {
      try {
        const updated = await pollImage(id);
        if (updated.status !== 'PROCESSING') {
          clearInterval(interval);
          polls.current.delete(id);
          setImages((prev) => prev.map((img) => (img.id === id ? updated : img)));
        }
      } catch (err) {
        console.error('Poll error:', err);
      }
    }, 2000);
    polls.current.set(id, interval);
  }

  function handleUploaded(image: ImageRecord) {
    setImages((prev) => [image, ...prev]);
    if (image.status === 'PROCESSING') startPolling(image.id);
  }

  async function handleDelete(id: string) {
    const interval = polls.current.get(id);
    if (interval) { clearInterval(interval); polls.current.delete(id); }
    await deleteImage(id);
    setImages((prev) => prev.filter((img) => img.id !== id));
  }

  return { images, handleUploaded, handleDelete };
}
```

- [ ] **Step 2: Create `frontend/src/App.tsx`**

```tsx
import Uploader from './components/Uploader';
import ImageGrid from './components/ImageGrid';
import { useImageUpload } from './hooks/useImageUpload';

export default function App() {
  const { images, handleUploaded, handleDelete } = useImageUpload();

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>Image Uploader</h1>
      <p style={{ color: '#6b7280', marginBottom: 24 }}>
        Upload JPEG, PNG, or HEIC images. Each is validated for size, sharpness, uniqueness, and face detection.
      </p>
      <div style={{ marginBottom: 40 }}>
        <Uploader onUploaded={handleUploaded} />
      </div>
      <ImageGrid images={images} onDelete={handleDelete} />
    </div>
  );
}
```

- [ ] **Step 3: Full smoke test in browser**

Ensure three terminals are running:
```
Terminal 1: cd backend && npm run dev
Terminal 2: cd backend && npm run worker
Terminal 3: cd frontend && npm run dev
```

Open http://localhost:5173 and verify:
1. Upload a JPEG with a clear face → appears as Processing → moves to Accepted
2. Upload the same image again → moves to Rejected ("Too similar...")
3. Upload a blurry image → moves to Rejected ("Image is too blurry")
4. Upload a tiny image (< 300px) → rejected immediately by frontend MIME check or backend size check
5. Upload a HEIC file → modal appears → confirm → uploads and processes

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/ frontend/src/App.tsx
git commit -m "feat: polling hook and app root — image upload flow complete"
```
