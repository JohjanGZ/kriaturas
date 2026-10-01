/**
 * LA CARA DE UNA KRIATURA — la afinidad, leída de un vistazo.
 *
 * Un número no dice nada emocional y una barra parece una estadística más. Una
 * cara se entiende sin leer: gris con la boca recta es indiferencia, verde con
 * los ojos contentos es cariño. Nadie necesita que le expliquen la escala.
 *
 * Inline SVG como las gemas y el arte de las kriaturas: escala a cualquier
 * tamaño, no cuesta una petición y se ve nítida en un móvil.
 *
 * El color NUNCA es la única señal — la boca cambia de forma en cada escalón.
 * Quien no distingue el verde del gris sigue viendo una línea recta
 * convertirse en una sonrisa.
 */

type Step = {
  /** Hasta qué porcentaje de la barra llega este escalón. */
  upTo: number;
  face: string;
  ring: string;
  label: string;
  /** La boca, como path SVG. La forma es la que lleva el significado. */
  mouth: string;
  /** Ojos felices (arcos) en lugar de puntos, en el último escalón. */
  happyEyes?: boolean;
};

const STEPS: Step[] = [
  {
    upTo: 20,
    face: '#9aa0ad',
    ring: '#6f7682',
    label: 'indiferente',
    mouth: 'M 9 16 L 15 16',
  },
  {
    upTo: 45,
    face: '#b9b07f',
    ring: '#8d855c',
    label: 'se va soltando',
    mouth: 'M 9 15.6 Q 12 16.6 15 15.6',
  },
  {
    upTo: 70,
    face: '#d8c25a',
    ring: '#a89338',
    label: 'a gusto',
    mouth: 'M 9 15 Q 12 17.2 15 15',
  },
  {
    upTo: 90,
    face: '#8fd06a',
    ring: '#5f9e3d',
    label: 'contenta',
    mouth: 'M 8.6 14.6 Q 12 18 15.4 14.6',
  },
  {
    upTo: 100,
    face: '#5fd36b',
    ring: '#2f9440',
    label: 'feliz',
    mouth: 'M 8.2 14.2 Q 12 18.8 15.8 14.2',
    happyEyes: true,
  },
];

export function stepFor(percent: number): Step {
  const clamped = Math.min(100, Math.max(0, percent));
  return STEPS.find((step) => clamped <= step.upTo) ?? STEPS[STEPS.length - 1]!;
}

export function affinityLabel(percent: number): string {
  return stepFor(percent).label;
}

export function AffinityFace({
  percent,
  className,
  title,
}: {
  /** Afinidad actual, de 0 a 100. */
  percent: number;
  className?: string;
  title?: string;
}) {
  const step = stepFor(percent);

  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label={title ?? `Afinidad: ${step.label}`}
    >
      <title>{title ?? `Afinidad: ${step.label}`}</title>
      <circle cx="12" cy="12" r="9.2" fill={step.face} stroke={step.ring} strokeWidth="1.4" />

      {step.happyEyes ? (
        <>
          <path
            d="M 7.8 10.6 Q 9.2 8.9 10.6 10.6"
            fill="none"
            stroke={step.ring}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M 13.4 10.6 Q 14.8 8.9 16.2 10.6"
            fill="none"
            stroke={step.ring}
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <circle cx="9.2" cy="10.2" r="1.15" fill={step.ring} />
          <circle cx="14.8" cy="10.2" r="1.15" fill={step.ring} />
        </>
      )}

      <path
        d={step.mouth}
        fill="none"
        stroke={step.ring}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
