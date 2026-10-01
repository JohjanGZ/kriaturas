import { describe, expect, it } from 'vitest';
import {
  addAffinity,
  deriveAffinity,
  isHighAffinity,
  nestChance,
  nestLaysEgg,
} from '@/core/affinity';
import type { AffinityConfig } from '@/core/schemas/config';

const config: AffinityConfig = {
  maxPoints: 100,
  floorPoints: 20,
  perFeed: 5,
  perBattle: 8,
  decayPerDay: 3,
  highThreshold: 60,
  chancePerHighCreature: 4,
  maxChancePercent: 20,
};

const day = (n: number): Date => new Date(Date.UTC(2026, 3, 1 + n, 12, 0, 0));

/**
 * La afinidad es LO ÚNICO del juego que decae con el reloj — decisión tomada a
 * propósito — y por eso lleva suelo. Y como la stamina, no se almacena: se
 * guarda lo ganado y el presente se deriva.
 */
describe('deriveAffinity', () => {
  it('es lo ganado mientras no pase el tiempo', () => {
    expect(deriveAffinity(50, day(0), day(0), config)).toBe(50);
  });

  it('baja un escalón por día sin atenderla', () => {
    expect(deriveAffinity(50, day(0), day(1), config)).toBe(47);
    expect(deriveAffinity(50, day(0), day(5), config)).toBe(35);
  });

  it('NUNCA baja del suelo: la ausencia enfría, no borra', () => {
    /** Cien días fuera dejarían -250 sin el suelo. */
    expect(deriveAffinity(90, day(0), day(100), config)).toBe(config.floorPoints);
  });

  it('el suelo protege lo ganado, no regala a quien nunca cuidó nada', () => {
    /** Diez puntos ganados siguen siendo diez, no suben al suelo. */
    expect(deriveAffinity(10, day(0), day(100), config)).toBe(10);
  });

  it('no va hacia atrás si el reloj viene del futuro', () => {
    expect(deriveAffinity(50, day(5), day(0), config)).toBe(50);
  });

  it('nunca pasa del máximo, por mucho que se guarde', () => {
    expect(deriveAffinity(500, day(0), day(0), config)).toBe(100);
  });
});

describe('addAffinity', () => {
  it('suma sobre el valor de HOY, no sobre lo guardado', () => {
    /**
     * Guardados 50, diez días sin verla: hoy son 20. Una comida los deja en
     * 25 — no en 55. Sumar sobre lo guardado resucitaría de golpe todo lo que
     * el tiempo se llevó.
     */
    expect(deriveAffinity(50, day(0), day(10), config)).toBe(20);
    expect(addAffinity(50, day(0), day(10), config.perFeed, config)).toBe(25);
  });

  it('tiene tope', () => {
    expect(addAffinity(98, day(0), day(0), 50, config)).toBe(100);
  });

  it('pelear une más que dar de comer', () => {
    const fed = addAffinity(0, day(0), day(0), config.perFeed, config);
    const fought = addAffinity(0, day(0), day(0), config.perBattle, config);
    expect(fought).toBeGreaterThan(fed);
  });
});

describe('el nido', () => {
  it('no hay probabilidad ninguna sin kriaturas contentas', () => {
    expect(nestChance(0, config)).toBe(0);
    expect(nestLaysEgg(0, config, () => 0)).toBe(false);
  });

  it('sube con cada kriatura en afinidad alta', () => {
    expect(nestChance(1, config)).toBe(4);
    expect(nestChance(3, config)).toBe(12);
  });

  it('NUNCA pasa del tope, tengas las que tengas', () => {
    /** El techo es lo que impide que el corral sea una fábrica de huevos. */
    expect(nestChance(5, config)).toBe(20);
    expect(nestChance(50, config)).toBe(20);
    expect(nestChance(9999, config)).toBe(config.maxChancePercent);
  });

  it('pone huevo cuando el dado cae por debajo', () => {
    /** Tres altas = 12%: un 0.05 es 5, que entra; un 0.5 es 50, que no. */
    expect(nestLaysEgg(3, config, () => 0.05)).toBe(true);
    expect(nestLaysEgg(3, config, () => 0.5)).toBe(false);
  });
});

describe('isHighAffinity', () => {
  it('cuenta desde el umbral, no antes', () => {
    expect(isHighAffinity(59, config)).toBe(false);
    expect(isHighAffinity(60, config)).toBe(true);
  });
});
