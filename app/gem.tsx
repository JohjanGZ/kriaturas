import type { CSSProperties } from 'react';

/**
 * A board gem drawn as a bevelled 3D block.
 *
 * Four bevel faces around a flat front face is what reads as "carved stone"
 * without any lighting maths: the top face catches the light, the bottom is in
 * shadow, and the two sides sit between them. Every element uses the same
 * geometry and only swaps the palette, so the board reads as one material.
 *
 * Pure SVG on purpose — it scales to any tile size, costs no network request,
 * and stays crisp on a phone.
 */

export type GemKind = 'fire' | 'water' | 'plant' | 'psychic' | 'food';

type Palette = {
  top: string;
  left: string;
  right: string;
  bottom: string;
  face: string;
  faceDeep: string;
  glyph: string;
};

/** Food has no palette here: it is not a block. */
const PALETTES: Record<Exclude<GemKind, 'food'>, Palette> = {
  fire: {
    top: '#ffc98a',
    left: '#ff9a4d',
    right: '#c2531a',
    bottom: '#8d3608',
    face: '#ff8a3d',
    faceDeep: '#d95e18',
    glyph: '#fff1dc',
  },
  water: {
    top: '#a8d8ff',
    left: '#5aa9ff',
    right: '#1f62b8',
    bottom: '#123f7d',
    face: '#3d9bff',
    faceDeep: '#1f6fd0',
    glyph: '#e8f4ff',
  },
  plant: {
    top: '#b6ecb0',
    left: '#68d16a',
    right: '#2f8f34',
    bottom: '#1b5c22',
    face: '#4fc44f',
    faceDeep: '#2f9c38',
    glyph: '#eafce8',
  },
  psychic: {
    top: '#dcc3f7',
    left: '#b483e6',
    right: '#7541ab',
    bottom: '#4d2a75',
    face: '#a86ce0',
    faceDeep: '#8449c2',
    glyph: '#f6ecff',
  },
};

/** The mark inside each block, so colour is never the only cue. */
function Glyph({ kind, color }: { kind: Exclude<GemKind, 'food'>; color: string }) {
  switch (kind) {
    case 'fire':
      return (
        <>
          {/* An asymmetric tip and a notch: a symmetric blob reads as a tulip. */}
          <path
            d="M55 24c1 11-4 15-9 19-2-4-2-8-1-12-8 7-14 16-14 26 0 12 9 21 20 21s20-9 20-21c0-13-6-23-16-33z"
            fill={color}
          />
          <path
            d="M50 50c3 4 6 8 6 13a6 6 0 0 1-12 0c0-4 3-8 6-13z"
            fill={color}
            opacity="0.55"
          />
        </>
      );
    case 'water':
      return <path d="M50 26c12 15 19 24 19 33a19 19 0 1 1-38 0c0-9 7-18 19-33z" fill={color} />;
    case 'plant':
      return (
        <>
          <path d="M50 76V44" stroke={color} strokeWidth="5" strokeLinecap="round" />
          <path d="M50 52c-14 0-22-8-22-20 14 0 22 7 22 20z" fill={color} />
          <path d="M50 44c14 0 22-7 22-19-14 0-22 7-22 19z" fill={color} />
        </>
      );
    case 'psychic':
      return (
        <path
          d="M50 30a20 20 0 1 0 20 20 14 14 0 1 1-14-14 8 8 0 1 0 8 8"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
        />
      );
  }
}

/**
 * FOOD is not carved stone.
 *
 * The four elements are blocks because they are the board's material; food is a
 * thing lying among them. Drawing it without the bevel is the clearest way to
 * say "this one charges nobody" — the silhouette carries the rule, so the
 * player does not have to remember it.
 */
function Fruit() {
  return (
    <>
      <ellipse cx="50" cy="86" rx="20" ry="5" fill="#000" opacity="0.28" />

      <defs>
        <radialGradient id="fruit-body" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0%" stopColor="#ff8fae" />
          <stop offset="55%" stopColor="#e8365f" />
          <stop offset="100%" stopColor="#94123a" />
        </radialGradient>
        <linearGradient id="fruit-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#8fe36a" />
          <stop offset="100%" stopColor="#2f8f34" />
        </linearGradient>
      </defs>

      {/* stem */}
      <path d="M50 34c1-8 0-13-3-18" stroke="#6b4a2a" strokeWidth="5" strokeLinecap="round" fill="none" />
      {/* leaf */}
      <path d="M52 24c10-9 20-9 27-6-3 10-12 16-24 12z" fill="url(#fruit-leaf)" />

      {/* body: two lobes, so it reads as fruit rather than a ball */}
      <circle cx="41" cy="62" r="22" fill="url(#fruit-body)" />
      <circle cx="61" cy="60" r="19" fill="url(#fruit-body)" />
      <circle cx="52" cy="66" r="20" fill="url(#fruit-body)" />

      {/* specular highlight */}
      <ellipse cx="38" cy="50" rx="8" ry="5" fill="#fff" opacity="0.55" transform="rotate(-25 38 50)" />
      <ellipse cx="63" cy="52" rx="4" ry="2.5" fill="#fff" opacity="0.35" transform="rotate(-20 63 52)" />
    </>
  );
}

export function Gem({
  kind,
  className,
  style,
}: {
  kind: GemKind;
  className?: string;
  style?: CSSProperties;
}) {
  if (kind === 'food') {
    return (
      <svg
        viewBox="0 0 100 100"
        className={className}
        style={style}
        role="presentation"
        focusable="false"
      >
        <Fruit />
      </svg>
    );
  }

  const palette = PALETTES[kind];
  const gradientId = `gem-face-${kind}`;

  return (
    <svg
      viewBox="0 0 100 100"
      className={className}
      style={style}
      role="presentation"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={palette.face} />
          <stop offset="100%" stopColor={palette.faceDeep} />
        </linearGradient>
      </defs>

      {/* bevels: top catches the light, bottom sits in shadow */}
      <path d="M6 6h88L78 22H22z" fill={palette.top} />
      <path d="M6 6l16 16v56L6 94z" fill={palette.left} />
      <path d="M94 6L78 22v56l16 16z" fill={palette.right} />
      <path d="M6 94h88L78 78H22z" fill={palette.bottom} />

      <rect x="22" y="22" width="56" height="56" rx="6" fill={`url(#${gradientId})`} />
      <rect
        x="22"
        y="22"
        width="56"
        height="56"
        rx="6"
        fill="none"
        stroke="#000"
        strokeOpacity="0.18"
        strokeWidth="2"
      />

      <g opacity="0.92">
        <Glyph kind={kind} color={palette.glyph} />
      </g>
    </svg>
  );
}
