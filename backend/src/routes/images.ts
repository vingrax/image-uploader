import { Router, type NextFunction } from 'express';
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

router.post('/', upload.single('image'), async (req, res, next: NextFunction) => {
  try {
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
  } catch (err) {
    next(err);
  }
});

router.get('/', async (_req, res, next: NextFunction) => {
  try {
    const images = await prisma.image.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(images);
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next: NextFunction) => {
  try {
    const image = await prisma.image.findUnique({ where: { id: req.params.id } });
    if (!image) return res.status(404).json({ error: 'Not found' });
    res.json(image);
  } catch (err) {
    next(err);
  }
});

router.delete('/:id', async (req, res, next: NextFunction) => {
  try {
    const image = await prisma.image.findUnique({ where: { id: req.params.id } });
    if (!image) return res.status(404).json({ error: 'Not found' });

    await deleteFromCloudinary(image.cloudinaryPublicId);
    await prisma.image.delete({ where: { id: req.params.id } });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

export default router;
