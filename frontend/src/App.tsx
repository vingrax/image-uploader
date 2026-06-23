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
