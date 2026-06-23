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
