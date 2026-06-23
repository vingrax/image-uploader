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
