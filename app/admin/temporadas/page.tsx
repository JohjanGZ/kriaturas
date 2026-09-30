import { getSeasonSheet, listSeasons } from '@/db/queries/season';
import { requireAdminPage } from '@/lib/auth';
import { activateSeasonAction, createSeasonAction, setAdjustmentAction } from './actions';

/**
 * SEASONS — nerfing and buffing without touching a species.
 *
 * The sheet shows what a species PRINTS and what this season does to it, side by
 * side, because a balance pass is a comparison: you are never asking "what is
 * this creature", you are asking "what is it right now, and by whose decision".
 */
export default async function SeasonsPage() {
  await requireAdminPage();

  const all = await listSeasons();
  const active = all.find((season) => season.isActive) ?? null;
  const sheet = active ? await getSeasonSheet(active.id) : [];

  return (
    <main className="shell">
      <h1>Temporadas</h1>
      <p className="small muted">
        Los ajustes se aplican <strong>encima</strong> de la especie y nunca la reescriben: al
        cerrar la temporada, cada kriatura vuelve sola a sus números impresos. Se copian en la
        partida al empezarla, así que un cambio no mueve el suelo de un combate en curso.
      </p>

      <section className="card">
        <h2>Nueva temporada</h2>
        <form action={createSeasonAction} className="row">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="name">Nombre</label>
            <input id="name" name="name" type="text" placeholder="Temporada 2" required />
          </div>
          <button className="btn-primary" type="submit">
            Crear
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Todas</h2>
        {all.length === 0 ? (
          <p className="small muted">Todavía no hay ninguna.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Empezó</th>
                <th>Ajustes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {all.map((season) => (
                <tr key={season.id}>
                  <td>
                    {season.name}{' '}
                    {season.isActive ? <span className="tag tag-plant">en curso</span> : null}
                  </td>
                  <td className="small muted">{season.startsAt.toISOString().slice(0, 10)}</td>
                  <td className="small">{season.adjustments}</td>
                  <td>
                    {season.isActive ? null : (
                      <form action={activateSeasonAction}>
                        <input type="hidden" name="seasonId" value={season.id} />
                        <button type="submit">Activar</button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {active ? (
        <section className="card">
          <h2>Ajustes de {active.name}</h2>
          <p className="small muted">
            Los valores son <strong>diferencias</strong>, no totales: -3 de ataque sigue siendo -3
            aunque mañana cambies la especie. Dejarlo todo en cero borra el ajuste.
          </p>

          <div className="grid">
            {sheet.map((row) => (
              <div className="card" key={row.speciesId}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{row.name}</strong>
                  <span className={`tag tag-${row.element}`}>{row.element}</span>
                </div>
                <p className="small muted">
                  Base: {row.baseAttack} de ataque · {row.baseManaCost} de maná
                </p>

                <form action={setAdjustmentAction}>
                  <input type="hidden" name="seasonId" value={active.id} />
                  <input type="hidden" name="speciesId" value={row.speciesId} />

                  <div className="row">
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label htmlFor={`atk-${row.speciesId}`}>Ataque</label>
                      <input
                        id={`atk-${row.speciesId}`}
                        name="attackDelta"
                        type="number"
                        defaultValue={row.attackDelta}
                        min={-99}
                        max={99}
                      />
                    </div>
                    <div className="field" style={{ marginBottom: 0 }}>
                      <label htmlFor={`mana-${row.speciesId}`}>Maná</label>
                      <input
                        id={`mana-${row.speciesId}`}
                        name="manaCostDelta"
                        type="number"
                        defaultValue={row.manaCostDelta}
                        min={-99}
                        max={99}
                      />
                    </div>
                  </div>

                  <div className="field">
                    <label htmlFor={`note-${row.speciesId}`}>Motivo</label>
                    <input
                      id={`note-${row.speciesId}`}
                      name="note"
                      type="text"
                      defaultValue={row.note ?? ''}
                      placeholder="por qué la tocas"
                    />
                  </div>

                  <p className="small">
                    Queda en <strong>{Math.max(1, row.baseAttack + row.attackDelta)}</strong> de
                    ataque y <strong>{Math.max(1, row.baseManaCost + row.manaCostDelta)}</strong> de
                    maná.
                  </p>

                  <button type="submit">Guardar</button>
                </form>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="notice">No hay temporada en curso: nadie está ajustado.</p>
      )}
    </main>
  );
}
