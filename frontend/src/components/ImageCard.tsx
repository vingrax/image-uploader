import type { ImageRecord } from '../types';

const STATUS_STYLES: Record<string, { bg: string; color: string; label: string }> = {
  PROCESSING: { bg: '#fef3c7', color: '#d97706', label: 'Processing' },
  ACCEPTED:   { bg: '#d1fae5', color: '#059669', label: 'Accepted' },
  REJECTED:   { bg: '#fee2e2', color: '#dc2626', label: 'Rejected' },
};

interface Props {
  image: ImageRecord;
  onDelete: (id: string) => void;
}

export default function ImageCard({ image, onDelete }: Props) {
  const style = STATUS_STYLES[image.status];

  return (
    <div style={{
      border: '1px solid #e5e7eb', borderRadius: 8,
      overflow: 'hidden', background: '#fff',
      boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
    }}>
      <img
        src={image.cloudinaryUrl}
        alt={image.originalName}
        style={{ width: '100%', height: 160, objectFit: 'cover', display: 'block' }}
      />
      <div style={{ padding: 12 }}>
        <p style={{
          margin: '0 0 8px', fontWeight: 500, fontSize: 13,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {image.originalName}
        </p>
        <span style={{
          display: 'inline-block', padding: '2px 10px', borderRadius: 12,
          fontSize: 12, fontWeight: 600, background: style.bg, color: style.color,
        }}>
          {style.label}
        </span>
        {image.rejectionReason && (
          <p style={{ margin: '6px 0 0', fontSize: 12, color: '#6b7280' }}>
            {image.rejectionReason}
          </p>
        )}
        <button
          onClick={() => onDelete(image.id)}
          style={{
            marginTop: 8, padding: '3px 10px', fontSize: 12,
            background: 'transparent', border: '1px solid #e5e7eb',
            borderRadius: 4, cursor: 'pointer', color: '#9ca3af',
          }}
        >
          Delete
        </button>
      </div>
    </div>
  );
}
