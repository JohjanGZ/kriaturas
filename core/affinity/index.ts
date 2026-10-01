import type { AffinityConfig } from '../schemas/config';

/**
 * AFINIDAD — lo que una kriatura siente por quien la cuida.
 *
 * Sube alimentándola y llevándola a pelear; **baja si la tienes abandonada**.
 * Esa bajada es una decisión del diseño y va contra la regla que gobierna la
 * stamina (la ausencia nunca quita nada), así que está confinada aquí y en
 * ningún otro sitio: nada más en el juego decae con el reloj.
 *
 * **No se almacena el valor, se almacena lo GANADO.** Igual que la stamina sale
 * de `last_fed`, la afinidad sale de dos columnas — los puntos que te ganaste y
 * cuándo fue la última vez que la tocaste — y el presente se deriva al leerla.
 * Un número guardado que alguien tiene que ir bajando necesita una tarea de
 * fondo, y una tarea de fondo es un reloj más que puede desincronizarse.
 *
 * Y hay un SUELO (`floorPoints`): una kriatura con la que jugaste cien horas no
 * vuelve a ser una desconocida por dos semanas de vacaciones. La ausencia
 * enfría, no borra.
 */

/** Los puntos de hoy: lo ganado, menos lo que se llevó el tiempo. */
export function deriveAffinity(
  points: number,
  touchedAt: Date,
  now: Date,
  config: AffinityConfig,
): number {
  const earned = Math.min(Math.max(points, 0), config.maxPoints);
  const days = Math.max(0, Math.floor((now.getTime() - touchedAt.getTime()) / 86_400_000));
  const lost = days * config.decayPerDay;

  /**
   * El suelo solo protege lo que YA habías ganado: no regala puntos a quien
   * nunca cuidó nada, por eso se compara contra lo ganado y no es un mínimo
   * absoluto.
   */
  const floor = Math.min(earned, config.floorPoints);
  return Math.max(floor, earned - lost);
}

/**
 * Suma puntos sobre el valor de HOY, no sobre el guardado.
 *
 * Sumar sobre lo guardado resucitaría de golpe toda la afinidad que el tiempo
 * se había llevado: una kriatura olvidada un mes volvería a tope con una sola
 * comida. Se normaliza primero y se suma después, igual que `feed` hace con el
 * ancla de la stamina.
 */
export function addAffinity(
  points: number,
  touchedAt: Date,
  now: Date,
  gained: number,
  config: AffinityConfig,
): number {
  const today = deriveAffinity(points, touchedAt, now, config);
  return Math.min(config.maxPoints, today + Math.max(0, gained));
}

/** ¿Cuenta como "afinidad alta" para el nido? */
export function isHighAffinity(affinity: number, config: AffinityConfig): boolean {
  return affinity >= config.highThreshold;
}

/**
 * La probabilidad de que hoy aparezca un huevo en el corral.
 *
 * Sube con cuántas kriaturas tienes en afinidad alta y **nunca pasa del tope**.
 * Ese techo es lo que mantiene al corral como un extra: la tienda sigue siendo
 * el camino fiable y la mina el afortunado, y ninguna cantidad de kriaturas
 * convierte el corral en una fábrica.
 */
export function nestChance(highCount: number, config: AffinityConfig): number {
  const raw = Math.max(0, highCount) * config.chancePerHighCreature;
  return Math.min(config.maxChancePercent, raw);
}

/** Tira el dado del nido. `random` se inyecta, como en todo `/core`. */
export function nestLaysEgg(
  highCount: number,
  config: AffinityConfig,
  random: () => number,
): boolean {
  const chance = nestChance(highCount, config);
  if (chance <= 0) return false;
  return random() * 100 < chance;
}
