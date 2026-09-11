import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { eq } from 'drizzle-orm';
import {
  type BattleState,
  type Combatant,
  type Rival,
  applyTurn,
  createPlayableBoard,
  findValidMove,
  hasValidMove,
  parseConfig,
  resolveMove,
  resolveTurn,
  startBattle,
  tileAtOrThrow,
} from '@/core';
import type { Board, BoardTileKind, Position } from '@/core/match3';
import { parseEffectList } from '@/core/effects/schema';
import { createConnection } from '@/db/client';
import { gameConfigs, games, species } from '@/db/schema';

/**
 * A playable battle in the terminal.
 *
 * A development tool, not part of the game: it exists so the mechanic can be
 * FELT and tuned before any screen is built. It reads the real config rows and
 * the real seeded species, so what you play here is what the web version will
 * do — the only thing missing is the pixels.
 *
 * Everything it needs comes from /core. The randomness is injected, so
 * `--seed=123` replays the exact same battle.
 */

const RESET = '\x1b[0m';
const COLOR: Record<BoardTileKind, string> = {
  fire: '\x1b[31m',
  water: '\x1b[34m',
  plant: '\x1b[32m',
  psychic: '\x1b[35m',
  food: '\x1b[90m',
};
const LETTER: Record<BoardTileKind, string> = {
  fire: 'F',
  water: 'A',
  plant: 'P',
  psychic: 'S',
  food: 'o',
};

const arg = (name: string): string | undefined =>
  process.argv.find((value) => value.startsWith(`--${name}=`))?.split('=')[1];

/** Deterministic PRNG so a seed replays a whole battle. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function bar(current: number, max: number, width = 10): string {
  const filled = max <= 0 ? 0 : Math.round((Math.min(current, max) / max) * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

function drawBoard(board: Board): string {
  const header = `     ${Array.from({ length: board.width }, (_, col) => String(col).padStart(2)).join(' ')}`;
  const rows: string[] = [header];
  for (let row = 0; row < board.height; row += 1) {
    let line = `  ${String(row).padStart(2)} `;
    for (let col = 0; col < board.width; col += 1) {
      const tile = tileAtOrThrow(board, { row, col });
      line += ` ${COLOR[tile]}${LETTER[tile]}${RESET} `;
    }
    rows.push(line);
  }
  return rows.join('\n');
}

function drawState(state: BattleState, board: Board): string {
  const enemy = state.rivals[0];
  const lines: string[] = ['', drawBoard(board), ''];

  if (enemy) {
    lines.push(
      `  RIVAL    ${bar(state.opponentHp, state.opponentMaxHp, 20)} ${state.opponentHp}/${state.opponentMaxHp}`,
    );
    for (const foe of state.rivals) {
      lines.push(
        `    ${foe.name.padEnd(12)} ${COLOR[foe.element as BoardTileKind] ?? ''}${foe.element}${RESET}  (pega ${foe.attack})`,
      );
    }
  }

  lines.push('');
  for (const member of state.team) {
    lines.push(
      `  ${member.creatureId.padEnd(14)} ${COLOR[member.baseElement]}${member.baseElement.padEnd(8)}${RESET}` +
        ` maná ${bar(member.mana, member.manaCost)} ${member.mana}/${member.manaCost}` +
        `  atq ${member.baseAttack}${member.isEvolved ? ' (evolucionada)' : ''}`,
    );
  }

  lines.push('');
  lines.push(
    `  TU VIDA  ${bar(state.playerHp, state.playerMaxHp, 20)} ${state.playerHp}/${state.playerMaxHp}` +
      (state.shield > 0 ? `   escudo ${state.shield} (${state.shieldTurns} turnos)` : ''),
  );
  return lines.join('\n');
}

/** "3,4 d" -> the two cells to swap. */
function parseMove(input: string, board: Board): [Position, Position] | string {
  const match = /^\s*(\d+)\s*[, ]\s*(\d+)\s+([adib])\s*$/i.exec(input);
  if (!match) return 'Formato: fila,columna dirección — por ejemplo "3,4 d". Dirección: a i d b';

  const row = Number(match[1]);
  const col = Number(match[2]);
  const dir = (match[3] ?? '').toLowerCase();

  const deltas: Record<string, Position> = {
    a: { row: row - 1, col },
    b: { row: row + 1, col },
    i: { row, col: col - 1 },
    d: { row, col: col + 1 },
  };
  const target = deltas[dir];
  if (!target) return 'Dirección no reconocida. Usa a (arriba), b (abajo), i (izq), d (der).';
  return [{ row, col }, target];
}

async function main(): Promise<void> {
  const { db, close } = await createConnection();
  const random = arg('seed') ? seeded(Number(arg('seed'))) : Math.random;
  let autoMoves = Number(arg('auto') ?? 0);

  try {
    const [game] = await db.select().from(games).where(eq(games.slug, 'kriaturas')).limit(1);
    if (!game) throw new Error('No hay juego sembrado. Ejecuta npm run db:seed');

    const configRows = await db.select().from(gameConfigs).where(eq(gameConfigs.gameId, game.id));
    const raw = (key: string): unknown => configRows.find((row) => row.key === key)?.value;
    const combat = parseConfig('combat', raw('combat'));
    const play = parseConfig('play', raw('play'));

    const roster = await db.select().from(species).where(eq(species.isPublished, true));
    if (roster.length < play.teamSize + 1) {
      throw new Error('No hay especies suficientes. Ejecuta npm run db:seed');
    }

    /**
     * The team takes species of DIFFERENT elements, so the board actually
     * matters. Two creatures of one element would leave three quarters of the
     * gems useless and hide the very trade-off a team of two is about.
     */
    const seen = new Set<string>();
    const teamRows = roster
      .filter((row) => {
        if (seen.has(row.baseElement)) return false;
        seen.add(row.baseElement);
        return true;
      })
      .slice(0, play.teamSize);

    const teamIds = new Set(teamRows.map((row) => row.id));
    const enemyRows = roster.filter((row) => !teamIds.has(row.id)).slice(0, 3);

    const team: Combatant[] = teamRows.map((row) => ({
      creatureId: row.name,
      baseElement: row.baseElement as Combatant['baseElement'],
      baseAttack: row.baseAttack,
      pathAttackBonus: 0,
      isEvolved: false,
      effects: parseEffectList(row.effects),
      manaCost: play.defaultManaCost,
      mana: 0,
    }));

    const rivals: Rival[] = enemyRows.map((row) => ({
      id: row.slug,
      name: row.name,
      element: row.baseElement,
      attack: Math.max(1, Math.round(row.baseAttack / 3)),
    }));

    let state = startBattle({ team, rivals, config: combat });
    let board = createPlayableBoard(
      { width: combat.boardWidth, height: combat.boardHeight, minMatchLength: combat.minMatchLength },
      random,
    );

    const io = createInterface({ input: process.stdin, output: process.stdout });
    console.log('\n  KRIATURAS — simulador de combate');
    console.log('  Mueve con "fila,columna dirección". Ejemplo: 3,4 d   ·   q para salir\n');

    while (state.status === 'active') {
      console.log(drawState(state, board));

      let parsed: readonly [Position, Position];

      if (autoMoves > 0) {
        /**
         * Demo mode: play the first legal move found, so a whole battle can be
         * watched — or verified — without anyone typing.
         */
        const suggestion = findValidMove(board, combat.minMatchLength);
        if (!suggestion) break;
        autoMoves -= 1;
        parsed = suggestion;
        console.log(
          `\n  jugada > auto ${suggestion[0].row},${suggestion[0].col} -> ${suggestion[1].row},${suggestion[1].col}`,
        );
      } else {
        const input = (await io.question('\n  jugada > ')).trim();
        if (input === 'q') break;

        const manual = parseMove(input, board);
        if (typeof manual === 'string') {
          console.log(`  ${manual}`);
          continue;
        }
        parsed = manual;
      }

      const move = resolveMove(
        board,
        parsed[0],
        parsed[1],
        {
          minMatchLength: combat.minMatchLength,
          maxCascades: combat.maxCascades,
          allowNonMatching: combat.allowFreeSwaps,
        },
        random,
      );

      if (!move.ok) {
        const why = {
          not_adjacent: 'Esas casillas no se tocan.',
          out_of_bounds: 'Fuera del tablero.',
          no_match: 'Ese intercambio no alinea nada. No gastas jugada.',
        }[move.reason];
        console.log(`  ${why}`);
        continue;
      }

      board = move.board;
      const outcome = resolveTurn({
        move,
        team: state.team,
        enemyElement: state.rivals[0]?.element ?? 'water',
        config: combat,
      });

      const applied = applyTurn(state, outcome);
      state = applied.state;
      const log = applied.log;

      console.log('');
      for (const attack of outcome.attacks) {
        const special = attack.charged
          ? `  ⚡ ESPECIAL  +${attack.effectDamage} daño${attack.heal > 0 ? ` +${attack.heal} vida` : ''}${attack.shield > 0 ? ` +${attack.shield} escudo` : ''}`
          : '';
        console.log(
          `  ${attack.creatureId}: ${attack.gemsCleared} gemas (racha ${attack.longestRun})` +
            ` · básico ${attack.basicDamage} · maná ${attack.manaAfter}/${attack.manaCost}${special}`,
        );
      }
      if (move.steps.length === 0) console.log('  Moviste sin alinear: gastas el turno.');
      else if (outcome.attacks.length === 0) console.log('  Nadie de tu equipo tenía ese elemento.');
      if (outcome.foodGained > 0) console.log(`  +${outcome.foodGained} comida`);
      if (outcome.cascades > 0) console.log(`  ${outcome.cascades} cascada(s)`);

      console.log(`  → ${log.damageToOpponent} de daño al rival`);
      if (applied.state.status === 'won') console.log('  → ¡Rival sin vida! No contraataca.');
      else {
        console.log(
          `  ← el rival pega ${log.rivalAttack}` +
            (log.absorbedByShield > 0 ? ` (escudo absorbe ${log.absorbedByShield})` : '') +
            ` · pierdes ${log.damageToPlayer}`,
        );
      }

      if (!hasValidMove(board, combat.minMatchLength)) {
        console.log('  Sin jugadas posibles: se baraja el tablero.');
        board = createPlayableBoard(
          {
            width: combat.boardWidth,
            height: combat.boardHeight,
            minMatchLength: combat.minMatchLength,
          },
          random,
        );
      }
      console.log('');
    }

    io.close();
    console.log(
      state.status === 'won'
        ? '\n  ¡VICTORIA! Limpiaste la oleada.\n'
        : state.status === 'lost'
          ? `\n  DERROTA. Aguantaste ${state.turn} turnos.\n`
          : '\n  Salida.\n',
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
