'use client';

import { useEffect, useState } from 'react';
import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from '@/lib/storage/types';

/**
 * File input with a local preview.
 *
 * The preview is a browser object URL — the file is not uploaded until the form
 * is submitted, and the server re-validates type and size regardless of what
 * this component allowed through.
 */
export function ImageField({
  name,
  label,
  currentUrl,
}: {
  name: string;
  label: string;
  currentUrl?: string | null;
}) {
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  const shown = preview ?? currentUrl ?? null;

  return (
    <div className="field">
      <label htmlFor={name}>{label}</label>

      {shown ? (
        <img className="thumb" src={shown} alt="" />
      ) : (
        <div className="thumb thumb-empty">sin imagen</div>
      )}

      <input
        id={name}
        name={name}
        type="file"
        accept={ALLOWED_IMAGE_TYPES.join(',')}
        style={{ marginTop: '0.5rem' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (preview) URL.revokeObjectURL(preview);

          if (!file) {
            setPreview(null);
            setError(null);
            return;
          }
          if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
            setPreview(null);
            setError('Formato no admitido: usa PNG, JPEG o WebP');
            event.target.value = '';
            return;
          }
          if (file.size > MAX_IMAGE_BYTES) {
            setPreview(null);
            setError(`Máximo ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
            event.target.value = '';
            return;
          }
          setError(null);
          setPreview(URL.createObjectURL(file));
        }}
      />

      {error ? <p className="error">{error}</p> : null}
      {currentUrl && !preview ? (
        <p className="small muted">Deja el campo vacío para conservar la imagen actual.</p>
      ) : null}
    </div>
  );
}
