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
