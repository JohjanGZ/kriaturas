import type { CSSProperties } from 'react';

/**
 * Placeholder creature art, drawn from the species' own data.
 *
 * A species with no uploaded image would otherwise be a grey box, which makes
 * the roster and the battle unreadable. This gives every one of them a
 * recognisable silhouette: the ELEMENT picks the palette and the crown shape,
 * and the NAME picks small variations, so two fire creatures still look like
 * different animals — and the same creature always looks the same.
 *
 * It is deliberately a stand-in. As soon as a species has `baseImagePath` the
 * real artwork is shown instead.
 */

/**
 * Evolved elements are drawn too: an evolution that did not CHANGE THE ANIMAL
 * would be a number going up, and the whole ceremony would land on nothing.
 */
export type ArtElement =
  /**
   * WHITE — a creature with no element yet. It is not a colour choice: it is
   * the mechanic made visible, an animal that has not decided what it is. It
   * gets no crown for the same reason, so at a glance it reads as unfinished
   * rather than as a pale version of something.
   */
  | 'none'
  | 'fire'
  | 'water'
  | 'plant'
  | 'psychic'
  | 'light'
  | 'ice'
  | 'poison'
  | 'astral'
  | 'rock';

const PALETTES: Record<ArtElement, { body: string; belly: string; dark: string; crown: string }> = {
  none: { body: '#f3f4f8', belly: '#ffffff', dark: '#b9bdcc', crown: '#e7e9f2' },
  fire: { body: '#ff8a3d', belly: '#ffd7b0', dark: '#b3480f', crown: '#ffb638' },
  water: { body: '#3d9bff', belly: '#cfe8ff', dark: '#17558f', crown: '#8ad8ff' },
  plant: { body: '#4fc44f', belly: '#dbf5d3', dark: '#256d2a', crown: '#8ee06a' },
  psychic: { body: '#a86ce0', belly: '#eadbfa', dark: '#5f3392', crown: '#f0a8e8' },

  /** Brighter, colder or darker than the base they came from — never the same. */
  light: { body: '#ffd85e', belly: '#fff6d4', dark: '#c98a00', crown: '#fffbe6' },
  ice: { body: '#7fe3ff', belly: '#e6fbff', dark: '#1f7fa3', crown: '#ffffff' },
  poison: { body: '#a557d6', belly: '#e9d2f7', dark: '#4d1f6b', crown: '#c8ff4d' },
  astral: { body: '#6f7bff', belly: '#dfe2ff', dark: '#2a2f8c', crown: '#ffd6f7' },
  rock: { body: '#a9906f', belly: '#e6dbc8', dark: '#5c4a33', crown: '#cbbba1' },
};

/** Which base silhouette an evolved element keeps: the animal is still itself. */
const CROWN_OF: Record<ArtElement, 'fire' | 'water' | 'plant' | 'psychic' | 'none'> = {
  none: 'none',
  fire: 'fire',
  water: 'water',
  plant: 'plant',
  psychic: 'psychic',
  light: 'fire',
  ice: 'water',
  poison: 'plant',
  astral: 'psychic',
  rock: 'plant',
};

const EVOLVED: ReadonlySet<ArtElement> = new Set<ArtElement>([
  'light',
  'ice',
  'poison',
  'astral',
  'rock',
]);

/** Stable pseudo-random from the name, so a creature never changes look. */
function hash(value: string): number {
  let total = 0;
  for (let i = 0; i < value.length; i += 1) total = (total * 31 + value.charCodeAt(i)) >>> 0;
  return total;
}

function Crown({
  element,
  color,
}: {
  element: 'fire' | 'water' | 'plant' | 'psychic' | 'none';
  color: string;
}) {
  switch (element) {
    /** No element, no crown: the shape itself says "not decided yet". */
    case 'none':
      return null;
    case 'fire':
      return <path d="M50 8c7 10 3 15 8 19-9 3-20 2-25-4 6-1 9-6 17-15z" fill={color} />;
    case 'water':
      return <path d="M50 10c9 11 13 17 13 22a13 13 0 0 1-26 0c0-5 4-11 13-22z" fill={color} />;
    case 'plant':
      return (
        <>
          <path d="M50 30c-13 0-21-7-21-18 13 0 21 7 21 18z" fill={color} />
          <path d="M50 30c13 0 21-7 21-18-13 0-21 7-21 18z" fill={color} opacity="0.85" />
        </>
      );
    case 'psychic':
      return (
        <>
          <circle cx="50" cy="16" r="7" fill={color} />
          <circle cx="50" cy="16" r="12" fill="none" stroke={color} strokeWidth="2" opacity="0.6" />
        </>
      );
  }
}

export function CreatureArt({
  element,
  name,
  className,
  style,
}: {
  element: ArtElement;
  name: string;
  className?: string;
  style?: CSSProperties;
}) {
  const palette = PALETTES[element] ?? PALETTES.none;
  const seed = hash(name);

  /** Small, stable variations so the roster does not look cloned. */
  const eyeGap = 10 + (seed % 5);
  const bodyWidth = 30 + (seed % 7);
  const grin = seed % 3;
  const gradientId = `creature-${element}-${seed % 1000}`;

  return (
    <svg viewBox="0 0 100 100" className={className} style={style} role="img" aria-label={name}>
      <defs>
        <radialGradient id={gradientId} cx="0.4" cy="0.3" r="0.85">
          <stop offset="0%" stopColor={palette.crown} />
          <stop offset="60%" stopColor={palette.body} />
          <stop offset="100%" stopColor={palette.dark} />
        </radialGradient>
      </defs>

      <ellipse cx="50" cy="90" rx="26" ry="5" fill="#000" opacity="0.18" />

      {/* An evolved creature wears a halo: the silhouette alone is too subtle. */}
      {EVOLVED.has(element) ? (
        <circle
          cx="50"
          cy="58"
          r="40"
          fill="none"
          stroke={palette.crown}
          strokeWidth="2"
          opacity="0.55"
          strokeDasharray="6 7"
        />
      ) : null}

      <Crown element={CROWN_OF[element]} color={palette.crown} />

      {/* body */}
      <ellipse cx="50" cy="60" rx={bodyWidth} ry="28" fill={`url(#${gradientId})`} />
      <ellipse cx="50" cy="68" rx={bodyWidth * 0.55} ry="16" fill={palette.belly} opacity="0.85" />

      {/* feet */}
      <ellipse cx={50 - bodyWidth * 0.5} cy="86" rx="9" ry="6" fill={palette.dark} />
      <ellipse cx={50 + bodyWidth * 0.5} cy="86" rx="9" ry="6" fill={palette.dark} />

      {/* eyes */}
      <circle cx={50 - eyeGap} cy="54" r="6" fill="#fff" />
      <circle cx={50 + eyeGap} cy="54" r="6" fill="#fff" />
      <circle cx={50 - eyeGap + 1} cy="55" r="3" fill="#1b1b19" />
      <circle cx={50 + eyeGap + 1} cy="55" r="3" fill="#1b1b19" />

      {/* mouth */}
      {grin === 0 ? (
        <path d="M44 68q6 6 12 0" stroke={palette.dark} strokeWidth="3" fill="none" strokeLinecap="round" />
      ) : grin === 1 ? (
        <ellipse cx="50" cy="69" rx="5" ry="4" fill={palette.dark} />
      ) : (
        <path d="M44 69h12" stroke={palette.dark} strokeWidth="3" strokeLinecap="round" />
      )}
    </svg>
  );
}
