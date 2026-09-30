import type { ConditionKey } from '@/core/effects/catalog';
import type { EffectType } from '@/core/effects/schema';

/**
 * The panel's WORDS for the power catalogue.
 *
 * `/core` owns the shape of each effect — which fields it has and what they may
 * hold — and knows nothing about Spanish. These are the names an admin reads,
 * and they live in one file because two screens show them: the editor where a
 * kriatura is built, and the reference list at /admin/poderes.
 */
export const EFFECT_LABELS: Record<EffectType, { name: string; help: string }> = {
  damage: {
    name: 'Golpe perforante',
    help: 'Atraviesa escudos y entra igual aunque bloqueen a la kriatura.',
  },
  damage_by_type: {
    name: 'Ventaja de elemento',
    help: 'Daño extra si el rival trae ese elemento. Lo para un escudo o un bloqueo.',
  },
  heal: { name: 'Curar vida', help: 'Recupera vida, con el tope de la barra.' },
  shield: { name: 'Escudo', help: 'Absorbe el daño que entra, y caduca aunque no se use.' },
  combo_bonus: {
    name: 'Bonus por combo',
    help: 'Porcentaje extra sobre el daño de la alineación que lo disparó.',
  },
  drain_mana: {
    name: 'Restar maná',
    help: 'Vacía barras enemigas. Con "robado", ese maná pasa a las tuyas.',
  },
  mana_boost: { name: 'Cargar maná', help: 'Llena tus propias barras sin alinear nada.' },
  absorb_fruit: {
    name: 'Absorber frutas',
    help: 'Le quita drakofruta al rival y la suma a tu barra compartida.',
  },
  extra_move: { name: 'Movimiento extra', help: 'Un movimiento más en este turno.' },
  steal_move: { name: 'Restar movimiento', help: 'El rival jugará su próximo turno más corto.' },
  poison: { name: 'Veneno', help: 'Vida perdida por cada MOVIMIENTO que haga la víctima.' },
  block_attack: { name: 'Bloquear ataque', help: 'Su golpe no entra cuando llene la barra.' },
  paralyze: { name: 'Paralizar', help: 'Su barra deja de cargarse: ni llega a disparar.' },
  convert_tiles: { name: 'Cambiar fichas', help: 'Pinta fichas del tablero con tu elemento.' },
  shuffle_board: { name: 'Revolver el tablero', help: 'Tablero nuevo: ningún plan sobrevive.' },
  lifesteal: { name: 'Robo de vida', help: 'Te curas un porcentaje del daño que hiciste.' },
  cleanse: { name: 'Purificar', help: 'Te quita veneno, bloqueos y parálisis.' },
  fruit_block: { name: 'Sellar frutas', help: 'El rival no acumula drakofruta: no se transforma.' },
};

export const EFFECT_NUMBER_LABELS: Record<string, string> = {
  value: 'Valor',
  duration_turns: 'Turnos',
  targets: 'Kriaturas afectadas',
};

export const CONDITION_LABELS: Record<ConditionKey, string> = {
  enemy_element: 'El rival trae este elemento',
  min_combo: 'Combo de al menos',
  min_gems: 'Gemas alineadas de su elemento',
  self_below_percent: 'Tu vida al o por debajo del %',
  enemy_below_percent: 'Vida del rival al o por debajo del %',
  min_fruits: 'Frutas acumuladas de al menos',
  turn_at_least: 'No antes del turno',
  self_evolved: 'Solo transformada',
};
