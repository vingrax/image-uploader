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
    const isHeic = file.type === 'image/heic' || file.name.toLowerCase().endsWith('.heic');
    if (isHeic) {
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
