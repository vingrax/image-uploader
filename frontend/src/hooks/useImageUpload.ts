import { useState, useEffect, useRef } from 'react';
import type { ImageRecord } from '../types';
import { listImages, pollImage, deleteImage } from '../api';

export function useImageUpload() {
  const [images, setImages] = useState<ImageRecord[]>([]);
  const polls = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    listImages()
      .then((imgs) => {
        setImages(imgs);
        imgs.filter((img) => img.status === 'PROCESSING').forEach((img) => startPolling(img.id));
      })
      .catch(console.error);
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
