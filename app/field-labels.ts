import type { FieldKind } from '@/core/fields';

/**
 * What each field is CALLED and what it does, in one line.
 *
 * `/core` owns the rule and stays language-free; this is the sentence the
 * player reads before the first move. It has to be one sentence: a field whose
 * rule takes a paragraph is a field nobody will remember mid-fight.
 */
export const FIELD_LABELS: Record<FieldKind, { name: string; icon: string; rule: string }> = {
  remolino: {
    name: 'Remolino',
    icon: '🌀',
    rule: 'Al acabar cada turno todas las fichas cambian de sitio.',
  },
  minado: {
    name: 'Campo minado',
    icon: '💣',
    rule: 'Las minas bajan un número por cada movimiento. Al llegar a 0 revientan lo que tienen alrededor, y eso no carga a nadie.',
  },
  volcan: {
    name: 'Volcán',
    icon: '🌋',
    rule: 'Un elemento cae el triple de veces: esa kriatura dispara sin parar y la otra pasa hambre.',
  },
  sequia: {
    name: 'Sequía',
    icon: '🏜',
    rule: 'No cae drakofruta: aquí nadie se transforma.',
  },
  vergel: {
    name: 'Vergel',
    icon: '🌳',
    rule: 'Drakofruta por todas partes: gana la carrera quien se transforme primero.',
  },
  santuario: {
    name: 'Santuario',
    icon: '✨',
    rule: 'Los dos recuperáis vida al final de cada turno. Partidas largas, muchos especiales.',
  },
  paramo: {
    name: 'Páramo',
    icon: '💀',
    rule: 'Los dos perdéis vida cada turno: hay que rematar rápido.',
  },
  duelo: {
    name: 'Duelo',
    icon: '⚔',
    rule: 'Un solo movimiento por turno, pero cada gema vale el doble de maná.',
  },
  resonancia: {
    name: 'Resonancia',
    icon: '🔊',
    rule: 'Las alineaciones largas pagan mucho más: guardar un cinco es enorme.',
  },
  vendaval: {
    name: 'Vendaval',
    icon: '🌬',
    rule: 'Al acabar el turno una columna al azar rota una posición.',
  },
};
