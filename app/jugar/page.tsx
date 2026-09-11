import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { deriveStamina } from '@/core/stamina';
import { getDb } from '@/db/client';
import { getActiveBattle, loadGameConfig } from '@/db/queries/battle';
import { creatures, evolutionPaths, species } from '@/db/schema';
import { getCurrentPlayer } from '@/lib/auth';
import { BattleBoard } from './board';
import { TeamPicker, type PickableCreature } from './team-picker';

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
  const active = await getActiveBattle(player.id);

  if (active) {
    const finished = active.status !== 'active';
    return (
      <main className="shell">
        <h1>Combate</h1>
        {finished ? (
          <p className={`notice ${active.status === 'won' ? 'notice-ok' : 'notice-error'}`}>
            {active.status === 'won' ? '¡Victoria!' : 'Derrota.'}
          </p>
        ) : null}
        <BattleBoard
          battleId={active.id}
          board={active.board}
          rivals={active.rivals}
          playerHp={active.playerHp}
          playerMaxHp={active.playerMaxHp}
          opponentHp={active.opponentHp}
          opponentMaxHp={active.opponentMaxHp}
          shield={active.shield}
          turn={active.turn}
          team={active.team}
          finished={finished}
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
      isEvolved: creatures.isEvolved,
      speciesName: species.name,
      element: species.baseElement,
      attack: species.baseAttack,
      manaCost: species.manaCost,
      pathBonus: evolutionPaths.attackBonus,
    })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .leftJoin(evolutionPaths, eq(evolutionPaths.id, creatures.evolutionPathId))
    .where(eq(creatures.playerId, player.id));

  const pickable: PickableCreature[] = rows.map((row) => {
    const snapshot = deriveStamina(row.lastFed, now, config.stamina);
    return {
      id: row.id,
      name: row.nickname ?? row.speciesName,
      element: row.element,
      attack: row.attack + (row.isEvolved ? (row.pathBonus ?? 0) : 0),
      manaCost: row.manaCost,
      stamina: snapshot.current,
      maxStamina: snapshot.max,
      canPlay: snapshot.current >= config.play.minStaminaToPlay,
      isEvolved: row.isEvolved,
    };
  });

  return (
    <main className="shell">
      <h1>Jugar</h1>
      <p className="small muted">
        Comida {player.food} · drakofruta {player.drakofruta} · monedas {player.coins}
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
