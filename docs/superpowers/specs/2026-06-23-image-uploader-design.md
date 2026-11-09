# Image Uploader — Design Spec
**Date:** 2026-06-23

---

## Overview

A full-stack image upload and validation platform. Users upload images via a React frontend; images are stored in Cloudinary; a background worker validates each image against 6 rules and marks it ACCEPTED or REJECTED. The frontend polls for status updates and displays images in two sections accordingly.

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Frontend | React + Vite + TypeScript |
| Backend | Node.js + Express + TypeScript |
| Database | PostgreSQL via Prisma ORM |
| Storage | Cloudinary |
| Queue | BullMQ + Redis |
| Image processing | sharp |
| Face detection | face-api.js (TensorFlow.js, runs in Node) |
| Real-time updates | Polling (GET /api/images/:id every 2s) |

---

## Architecture

```
React Frontend
  │  POST /api/images (multipart/form-data)  → { id, status: "PROCESSING" }
  │  GET  /api/images/:id (poll every 2s)    → { status, rejectionReason }
  │  GET  /api/images                        → all images (initial load)
  ▼
Express API Server
  ├── multer (memory storage) → Cloudinary upload
  ├── Prisma → INSERT image record (status: PROCESSING)
  └── BullMQ → add job to queue → return response immediately
          │
          ▼
       Redis (BullMQ job queue)
          │
          ▼
       Worker Process (worker.ts — separate Node process)
          1. Convert HEIC → JPEG (sharp)
          2. Check min file size (< 50KB → reject)
          3. Check min resolution (< 300×300px → reject)
          4. Blur detection (Laplacian variance < 100 → reject)
          5. Similarity check (pHash Hamming distance < 10 vs DB → reject)
          6. Face detection (face-api.js SSD MobileNet)
             a. 0 faces → reject "No face detected"
             b. > 1 face → reject "Multiple faces detected"
             c. face bounding box < 10% image area → reject "Face too small"
          7. Prisma → UPDATE status (ACCEPTED | REJECTED) + rejectionReason
          │
          ├── PostgreSQL (metadata + status + pHash)
          └── Cloudinary (image files — original preserved)
```

---

## Database Schema (Prisma)

```prisma
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

---

## API Endpoints

| Method | Path | Request | Response |
|--------|------|---------|----------|
| `POST` | `/api/images` | `multipart/form-data` with `image` field | `{ id, status, createdAt }` |
| `GET` | `/api/images` | — | `Image[]` |
| `GET` | `/api/images/:id` | — | `Image` |
| `DELETE` | `/api/images/:id` | — | `{ success: true }` |

---

## Validation Rules

### Frontend (before upload)
- File type: only `image/jpeg`, `image/png`, `image/heic` accepted via file input `accept` attribute + JS MIME type check
- HEIC conversion confirmation: if selected file is HEIC, show a modal dialog — "This image is in HEIC format and will be converted to JPEG on upload. Continue?" — with Confirm / Cancel. Upload only proceeds on confirmation; Cancel discards the selection.

### Backend Worker (in order — fail fast)

1. **Format check** — HEIC files converted to JPEG via sharp before further processing
2. **Minimum size** — reject if `fileSize < 50KB` OR `width < 300 OR height < 300`
3. **Blur detection** — use `sharp` to get raw grayscale pixel buffer → apply 3×3 Laplacian kernel manually → compute variance of output; variance < 100 → reject "Image is too blurry". (sharp has no built-in Laplacian; raw buffer approach avoids adding jimp/image-js.)
4. **Similarity** — compute pHash via `image-hash` npm package (wraps sharp internally) → query DB for all ACCEPTED image pHashes → Hamming distance < 10 → reject "Too similar to an existing image"
5. **Face count** — run face-api.js `detectAllFaces()` with SSD MobileNet model:
   - 0 detections → reject "No face detected"
   - > 1 detection → reject "Multiple faces detected"
   - face bounding box area / image area < 0.10 → reject "Face too small"

---

## Frontend Components

```
src/
├── components/
│   ├── Uploader.tsx       # drag-drop zone + file picker, frontend MIME validation, HEIC confirmation modal
│   ├── ImageCard.tsx      # thumbnail preview + status badge (Processing/Accepted/Rejected)
│   └── ImageGrid.tsx      # two-column layout: Accepted | Rejected
├── hooks/
│   └── useImageUpload.ts  # handles upload, starts polling loop, updates state on resolution
└── App.tsx                # fetches initial image list, renders Uploader + ImageGrid
```

**State shape (React):**
```ts
type ImageRecord = {
  id: string
  originalName: string
  cloudinaryUrl: string
  status: 'PROCESSING' | 'ACCEPTED' | 'REJECTED'
  rejectionReason?: string
  createdAt: string
}
```

**Polling logic:**
- On upload response, store `imageId` and start a `setInterval` (2s)
- On each tick, call `GET /api/images/:id`
- When `status !== 'PROCESSING'`, clear interval and update UI

---

## Project Structure

```
image-uploader/
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   ├── hooks/
│   │   └── App.tsx
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   │   └── images.ts
│   │   ├── lib/
│   │   │   ├── cloudinary.ts
│   │   │   └── validations/
│   │   │       ├── blur.ts
│   │   │       ├── similarity.ts
│   │   │       └── faces.ts
│   │   ├── queue.ts       # BullMQ queue + job types
│   │   ├── worker.ts      # BullMQ worker (run as separate process)
│   │   └── server.ts      # Express app entry
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
├── docker-compose.yml     # Redis + PostgreSQL
└── docs/
    └── decisions.md
```

---

## Infrastructure (local dev)

```yaml
# docker-compose.yml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_DB: image_uploader
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
```

---

## Environment Variables

```
# backend/.env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/image_uploader
REDIS_URL=redis://localhost:6379
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=

# frontend/.env
VITE_API_URL=http://localhost:3001
```

---

## Security Considerations

- multer limits file size to 20MB max in memory
- Only JPEG/PNG/HEIC MIME types accepted server-side (in addition to frontend check)
- Cloudinary public IDs are system-generated, not user-supplied
- No direct file system writes — all files go through Cloudinary
- DELETE cleans up both DB record and Cloudinary asset

---

## Setup Notes

- **face-api.js models** — SSD MobileNet model weights must be downloaded into `backend/models/` at setup time (not in node_modules). Worker loads them via `faceapi.nets.ssdMobilenetv1.loadFromDisk('./models')`.
- **HEIC support in sharp** — requires `sharp` v0.32+ which bundles libheif. No extra peer dependency needed on recent versions.
- **image-hash** — install as `npm install image-hash`. Requires sharp as a peer; already in dependencies.

---

## Known Limitations / Out of Scope

- No authentication / user sessions
- pHash similarity only compares against ACCEPTED images (not rejected ones)
- face-api.js accuracy lower than cloud APIs on edge cases
- Polling stops after status resolves; no retry on network failure
