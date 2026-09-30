import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { applyAdjustment, effectiveAdjustment } from '@/core/balance';
import { deriveStamina } from '@/core/stamina';
import { getDb } from '@/db/client';
import { getBattleToShow, loadGameConfig } from '@/db/queries/battle';
import { adjustmentFor, loadSeasonBalance } from '@/db/queries/season';
import { creatures, evolutionPaths, species } from '@/db/schema';
import { redirect } from 'next/navigation';
import { getCurrentPlayer, hasDevFallback } from '@/lib/auth';
import { BattleBoard } from './board';
import { TeamPicker, type PickableCreature } from './team-picker';

/**
 * How long a request from this route may take, on the host that reads it.
 *
 * A move is the heaviest thing the game does: it resolves your turn, plays the
 * bot's, and writes the board, both lives, every bar and the objective progress
 * in one transaction. On a hosted deploy those queries cross a network to a
 * database that may have scaled to zero and has to wake up, and the default
 * ceiling on a free plan is around ten seconds — short enough that a cold first
 * move can be cut off half-written.
 *
 * Thirty is comfortably inside what a free plan allows while being far more than
 * a warm move needs. It is a ceiling, not a delay: nothing gets slower for
 * having room.
 */
export const maxDuration = 30;

/**
 * The play screen.
 *
 * Every number on it is derived on the server for this render: stamina from the
 * regeneration anchor, mana from the battle rows, health from the battle row.
 * The page has no state of its own to be wrong about.
 */
export default async function PlayPage() {
  const player = await getCurrentPlayer();
  if (!player) {
    /**
     * On a SERVER there is no seeded fallback, so "no player" means "nobody has
     * entered yet" and the answer is the door, not an error. On a laptop it
     * really does mean the database was never seeded, and saying so is more
     * useful than a button that would create a second account.
     */
    if (!hasDevFallback()) redirect('/entrar');

    return (
      <main className="shell">
        <h1>Jugar</h1>
        <div className="card">
          <p>No hay jugador todavía.</p>
          <p className="small muted">
            Ejecuta <code>npm run db:seed</code> para crear la cuenta de desarrollo.
          </p>
        </div>
      </main>
    );
  }

  const config = await loadGameConfig();
  /** The battle in progress, or a finished one whose result is still unread. */
  const active = await getBattleToShow(player.id);

  if (active) {
    const finished = active.status !== 'active';
    return (
      <main className="shell">
        <BattleBoard
          battleId={active.id}
          board={active.board}
          rivals={active.rivals}
          playerHp={active.playerHp}
          playerMaxHp={active.playerMaxHp}
          opponentHp={active.opponentHp}
          opponentMaxHp={active.opponentMaxHp}
          shield={active.shield}
          opponentShield={active.opponentShield}
          field={active.field}
          fruits={active.fruits}
          rivalFruits={active.rivalFruits}
          fruitsToEvolve={active.fruitsToEvolve}
          canEvolve={active.canEvolve}
          turn={active.turn}
          movesLeft={active.movesLeft}
          movesPerTurn={active.movesPerTurn}
          team={active.team}
          finished={finished}
          status={active.status}
          rewards={{ coins: config.play.coinsPerWin }}
        />
      </main>
    );
  }

  const db = await getDb();
  const now = new Date();

  const rows = await db
    .select({
      id: creatures.id,
      nickname: creatures.nickname,
      lastFed: creatures.lastFed,
      isExcellent: creatures.isExcellent,
      speciesName: species.name,
      element: species.baseElement,
      attack: species.baseAttack,
      manaCost: species.manaCost,
      speciesId: creatures.speciesId,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(eq(creatures.playerId, player.id));

  /** You pick a team by its numbers, so they must be THIS season's numbers. */
  const balance = await loadSeasonBalance();

  const pickable: PickableCreature[] = rows.map((row) => {
    const snapshot = deriveStamina(row.lastFed, now, config.stamina);
    /** Effective, not raw: an excellent creature ignores the season's nerfs. */
    const adjustment = effectiveAdjustment(adjustmentFor(balance, row.speciesId), {
      excellent: row.isExcellent,
    });
    const tuned = applyAdjustment({ attack: row.attack, manaCost: row.manaCost }, adjustment);
    return {
      id: row.id,
      name: row.nickname ?? row.speciesName,
      element: row.element,
      /** Outside a battle a creature is always its base form: it looks like itself. */
      evolvedElement: null,
      attack: tuned.attack,
      manaCost: tuned.manaCost,
      attackDelta: adjustment.attackDelta,
      manaCostDelta: adjustment.manaCostDelta,
      stamina: snapshot.current,
      maxStamina: snapshot.max,
      canPlay: snapshot.current >= config.play.minStaminaToPlay,
      isExcellent: row.isExcellent,
    };
  });

  return (
    <main className="shell">
      <h1>Jugar</h1>
      <p className="small muted">
        Comida {player.food} · monedas {player.coins}
      </p>

      {pickable.length === 0 ? (
        <div className="card">
          <p>No tienes kriaturas.</p>
          <p className="small muted">
            Ejecuta <code>npm run db:seed</code> o crea especies en el{' '}
            <Link href="/admin/species">panel admin</Link>.
          </p>
        </div>
      ) : (
        <TeamPicker creatures={pickable} teamSize={config.play.teamSize} />
      )}
    </main>
  );
}
