import Link from 'next/link';
import { redirect } from 'next/navigation';
import { deriveStamina } from '@/core/stamina';
import { loadGameConfig } from '@/db/queries/battle';
import { listPlayerCreatures } from '@/db/queries/creature';
import { getCurrentPlayer, hasDevFallback } from '@/lib/auth';
import { CreatureArt, type ArtElement } from '../creature-art';

/**
 * The roster. Stamina is DERIVED here for this render from each creature's
 * anchor — there is no stored number to go stale.
 */
export default async function CreaturesPage() {
  const player = await getCurrentPlayer();
  if (!player) {
    /** No fallback on a server: "no player" means nobody has entered yet. */
    if (!hasDevFallback()) redirect('/entrar');

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
        Comida {player.food} · monedas {player.coins}
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
              <article
                className={`card species-card${row.element === null ? ' card-white' : ''}`}
                key={row.id}
              >
                <CreatureArt
                  element={(row.element ?? 'none') as ArtElement}
                  name={row.name}
                  className="creature-thumb"
                />
                <div>
                  <span className={`tag tag-${row.element ?? 'none'}`}>
                    {row.element ?? 'sin elemento'}
                  </span>{' '}
                  {row.isExcellent ? (
                    <span className="tag tag-excellent">✦ excelente</span>
                  ) : null}
                </div>
                <strong>{row.name}</strong>
                <span className="small muted">{row.speciesName}</span>
                {/*
                  * A white creature is told what it is MISSING, right where the
                  * element would be. Left blank it would just look like a bug.
                  */}
                {row.element === null ? (
                  <span className="small muted">
                    Nace en blanco. Necesita una piedra elemental para poder luchar — hasta
                    entonces no se puede llevar a una partida.
                  </span>
                ) : null}
                <span className="small">
                  Ataque {row.attack} · maná {row.manaCost}
                </span>
                {row.attackDelta !== 0 || row.manaCostDelta !== 0 ? (
                  <span className="small season-tuned">ajustada esta temporada</span>
                ) : null}

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
                  Cuidar
                </Link>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
