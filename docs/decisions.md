# Architecture Decision Record — Image Uploader

## 1. Cloud Storage: Cloudinary

**Options considered:**
- AWS S3 — industry standard, IAM/bucket setup takes 10-15 min, requires credit card for free tier
- Cloudinary — 2 min setup, no credit card, generous free tier (25GB), built-in HEIC-to-JPEG conversion
- Supabase Storage — single platform for DB + storage, but adds another service to manage

**Decision:** Cloudinary

**Why:** Fastest setup under the time constraint. Built-in HEIC conversion eliminates a separate processing step. CDN delivery included out of the box.

**Trade-off:** Vendor lock-in on image delivery URLs. In production, S3 would give more control over access policies and lifecycle rules.

---

## 2. Face Detection: face-api.js

**Options considered:**
- AWS Rekognition — highly accurate, but requires another AWS account + IAM setup (~15 min)
- Google Vision API — accurate, but another account + billing setup
- face-api.js — pure JS, runs in Node.js backend, TensorFlow.js models run locally, no external API

**Decision:** face-api.js

**Why:** Zero additional accounts or API keys. Works offline. Fast enough for demo purposes. Models load once on worker startup.

**Trade-off:** Less accurate than cloud APIs, especially on edge cases (partial faces, unusual lighting). Model files add ~6MB to the backend. Slower cold start on first load.

---

## 3. ORM: Prisma

**Options considered:**
- Prisma — schema-first, auto-generated types, `prisma migrate dev` for fast iterations
- Knex — lightweight SQL builder, more control, no magic, but verbose schema management
- Sequelize — ActiveRecord style, familiar but verbose and slower to set up
- Objection.js — built on Knex, good relational modeling, less community momentum

**Decision:** Prisma

**Why:** Schema-first approach with `schema.prisma` maps directly to the DB. Auto-generated TypeScript types eliminate a whole class of runtime bugs. `prisma migrate dev` is the fastest path from zero to a working DB schema.

**Trade-off:** Prisma abstracts raw SQL, which can make complex queries harder to optimize. The Prisma client is heavier than Knex. Migration files are Prisma-specific and not portable.

---

## 4. Async Processing: BullMQ + Redis

**Options considered:**
- Simulated async — validations run in-process during the request, UI shows a spinner; simpler but blocks the event loop for heavy processing
- BullMQ + Redis — proper job queue, worker runs in a separate process, non-blocking upload endpoint

**Decision:** BullMQ + Redis

**Why:** face-api.js inference and sharp image processing are CPU-intensive. Running them in the request handler would block Node's event loop and cause timeout issues under concurrent uploads. A separate worker process keeps the API responsive.

**Trade-off:** Requires Redis as an additional service. Adds operational complexity (two processes to run). Debugging cross-process failures is harder. Mitigated by using docker-compose to manage Redis locally.

---

## 5. Real-time Updates: Polling (switched from SSE)

**Options considered:**
- WebSockets (Socket.io) — bidirectional, best UX, but adds socket plumbing on both client and server
- Server-Sent Events (SSE) — unidirectional push from server, simpler than WebSockets
- Polling — frontend calls `GET /api/images/:id` every 2 seconds until status resolves

**Initial choice:** SSE

**Why we switched to polling:** With BullMQ, the worker runs in a separate process from the Express server. SSE connections are held in the API process, so the worker cannot push directly to them. The bridge requires Redis pub/sub:

```
Worker → Redis pub/sub → API subscriber → SSE client map → HTTP stream
```

This adds 3 extra layers of failure surface. A missed subscription, stale client map, or dropped SSE connection silently fails — hard to debug under time pressure.

**Decision:** Polling

**Why:** Worker's only job is writing to the DB. Frontend polls `GET /api/images/:id` every 2 seconds. Zero cross-process coordination. Page refresh doesn't lose state. 2-second delay is imperceptible in a demo.

**Trade-off:** More HTTP requests (one every 2s per in-flight image). Not suitable for production at scale without a proper push mechanism. Acceptable for this assessment's scope.

---

## 6. Similarity Detection: Perceptual Hashing (pHash)

**Options considered:**
- ML embeddings (CLIP, ResNet) — high accuracy, catches semantic similarity, but requires a model server
- Average hash (aHash) — simple but inaccurate, too many false positives on similar-but-different images
- Perceptual hash (pHash) — frequency-domain hash, robust to minor edits (crop, resize, brightness), fast Hamming distance comparison

**Decision:** pHash via `sharp` (grayscale + resize + DCT approximation) or `imghash` npm package

**Why:** No model inference needed. Hash stored as a string in the DB. Comparison is a simple Hamming distance calculation. Effective for catching duplicate uploads and minor re-edits.

**Trade-off:** Won't catch semantic duplicates (same person, different photo). Hamming distance threshold (< 10) needs tuning — too low = false rejections, too high = missed duplicates.

---

## 7. Blur Detection: Laplacian Variance

**Approach:** Convert image to grayscale, apply Laplacian filter (edge detection) via `sharp`, compute variance of the output. Low variance = few edges = blurry image.

**Threshold:** Reject if variance < 100 (tunable).

**Why:** Industry-standard approach. Pure computation via sharp, no ML needed. Fast and accurate for typical blur cases.

**Trade-off:** Fails on intentionally soft/artistic images. Threshold is image-content-dependent — a solid-color background image may score low even if sharp.

---

## 8. HEIC Conversion

**Approach:** Use `sharp` with the `heic-decode` or built-in HEIC support to convert to JPEG before processing.

**Why:** Cloudinary accepts HEIC but processing with face-api.js and sharp's analysis features requires a raster format. Converting early in the pipeline means all downstream steps work on JPEG.

**Trade-off:** Adds a processing step. HEIC files are larger before conversion, so memory usage spikes briefly. Mitigated by streaming rather than buffering the full file.
