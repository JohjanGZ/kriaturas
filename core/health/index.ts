import type { HealthConfig, StaminaConfig } from '../schemas/config';

/**
 * ENFERMAR — el precio de exprimir a una kriatura.
 *
 * La regla cabe en una frase: **si la dejas seca, puede enfermar**. Y esa frase
 * es lo que hace que esto no sea un castigo, porque la stamina solo baja
 * JUGANDO — el modelo garantiza que estar ausente únicamente puede subirla. Así
 * que desaparecer una semana deja a las kriaturas más seguras, no menos, y el
 * riesgo es siempre consecuencia de algo que el jugador decidió hacer.
 *
 * De ahí salen las tres decisiones que tiene dentro:
 *
 * 1. **Se tira UNA vez**, cuando la kriatura cae por debajo del mínimo para
 *    jugar. Tirar en cada partida sonaba parecido y no lo es: con cuatro
 *    partidas por sesión, un 20% por partida deja casi la mitad de las sesiones
 *    terminando en enfermedad. Una sola tirada convierte eso en una de cada
 *    cinco, y aparece la decisión de verdad: ¿juego la última o la dejo con algo
 *    en la barra?
 * 2. **Cero al 100%.** No un 1%: un suelo significaría que una kriatura puede
 *    enfermar sin que pudieras haber hecho nada, que es exactamente la
 *    sensación que esto evita. Cero es una promesa sobre la que decidir —
 *    aliméntala y está a salvo.
 * 3. **La curva es convexa, no recta.** Recta, media barra ya da la mitad del
 *    riesgo y se vuelve un impuesto constante. Al cubo, la zona segura es ancha
 *    y el peligro es un aviso claro al final del todo.
 *
 * Enferma no significa muerta: la barra sigue subiendo, pero con el techo bajo.
 * La kriatura juega floja en vez de desaparecer de tu corral mientras consigues
 * la medicina.
 */

/**
 * The chance of falling ill, as a percentage, for a creature at this stamina.
 *
 * Exactly zero at a full bar. Rises with the cube of how empty it is, so the
 * risk hugs the floor until the creature is genuinely spent.
 */
export function illnessChance(stamina: number, config: HealthConfig, max: number): number {
  if (max <= 0) return 0;
  const rested = Math.min(Math.max(stamina, 0), max) / max;
  if (rested >= 1) return 0;

  const emptiness = 1 - rested;
  return config.chanceAtEmptyPercent * emptiness ** 3;
}

/**
 * Rolls it. `random` comes in as an argument like everywhere else in `/core`,
 * so a test is deterministic and production passes a real source.
 */
export function fallsIll(
  stamina: number,
  config: HealthConfig,
  max: number,
  random: () => number,
): boolean {
  const chance = illnessChance(stamina, config, max);
  if (chance <= 0) return false;
  return random() * 100 < chance;
}

/**
 * How high the bar can go. The whole thing normally; a fraction of it while
 * sick.
 *
 * A CEILING and not a freeze: feeding a sick creature still does something, it
 * just cannot do much. "Feeding does nothing at all" reads as a broken button,
 * and a creature stuck at zero until a quest is finished is one you cannot play
 * with for days.
 */
export function staminaCeiling(
  sick: boolean,
  health: HealthConfig,
  stamina: StaminaConfig,
): number {
  if (!sick) return stamina.maxStamina;
  return Math.max(1, Math.floor((stamina.maxStamina * health.sickCeilingPercent) / 100));
}

/**
 * Should this creature be checked at all?
 *
 * Only the ones that just dropped below the threshold to play — the moment the
 * player caused by spending the last of it. A creature that is already ill is
 * never rolled again: being sick twice is not a thing, and rolling anyway would
 * quietly reset the clock on how long it has been.
 */
export function shouldRollForIllness(params: {
  staminaAfter: number;
  minStaminaToPlay: number;
  alreadySick: boolean;
}): boolean {
  if (params.alreadySick) return false;
  return params.staminaAfter < params.minStaminaToPlay;
}
