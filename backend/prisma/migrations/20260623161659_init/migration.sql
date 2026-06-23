-- CreateEnum
CREATE TYPE "ImageStatus" AS ENUM ('PROCESSING', 'ACCEPTED', 'REJECTED');

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "cloudinaryUrl" TEXT NOT NULL,
    "cloudinaryPublicId" TEXT NOT NULL,
    "status" "ImageStatus" NOT NULL DEFAULT 'PROCESSING',
    "rejectionReason" TEXT,
    "pHash" TEXT,
    "blurScore" DOUBLE PRECISION,
    "faceCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);
