import Link from 'next/link';
import { deriveStamina } from '@/core/stamina';
import { loadGameConfig } from '@/db/queries/battle';
import { listPlayerCreatures } from '@/db/queries/creature';
import { getCurrentPlayer } from '@/lib/auth';
import { CreatureArt, type ArtElement } from '../creature-art';

/**
 * The roster. Stamina is DERIVED here for this render from each creature's
 * anchor — there is no stored number to go stale.
 */
export default async function CreaturesPage() {
  const player = await getCurrentPlayer();
  if (!player) {
    return (
      <main className="shell">
        <h1>Mis kriaturas</h1>
        <div className="card">
          <p>No hay jugador todavía.</p>
          <p className="small muted">
            Ejecuta <code>npm run db:seed</code>.
          </p>
        </div>
      </main>
    );
  }

  const config = await loadGameConfig();
  const rows = await listPlayerCreatures(player.id);
  const now = new Date();

  return (
    <main className="shell">
      <h1>Mis kriaturas</h1>
      <p className="small muted">
        Comida {player.food} · drakofruta {player.drakofruta} · monedas {player.coins} ·
        evoluciones hechas {player.evolutionsPerformed}
      </p>

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted">No tienes kriaturas.</p>
        </div>
      ) : (
        <div className="grid">
          {rows.map((row) => {
            const stamina = deriveStamina(row.lastFed, now, config.stamina);
            const rested = stamina.current >= config.play.minStaminaToPlay;
            return (
              <article className="card species-card" key={row.id}>
                <CreatureArt
                  element={row.element as ArtElement}
                  name={row.name}
                  className="creature-thumb"
                />
                <div>
                  <span className={`tag tag-${row.element}`}>{row.element}</span>{' '}
                  {row.isEvolved ? (
                    <span className="tag tag-muted">{row.evolvedElement}</span>
                  ) : null}
                </div>
                <strong>{row.name}</strong>
                <span className="small muted">{row.speciesName}</span>
                <span className="small">
                  Ataque {row.attack} · maná {row.manaCost}
                </span>

                <label>Stamina</label>
                <div className="bar">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${Math.round((stamina.current / stamina.max) * 100)}%`,
                      background: rested ? 'var(--ok)' : 'var(--danger)',
                    }}
                  />
                  <span className="bar-text">
                    {stamina.current}/{stamina.max}
                  </span>
                </div>
                {stamina.isFull ? null : (
                  <span className="small muted">
                    +1 en {Math.ceil((stamina.secondsUntilNextPoint ?? 0) / 60)} min
                  </span>
                )}

                <Link className="btn" href={`/kriaturas/${row.id}`}>
                  Cuidar y evolucionar
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
