import Link from 'next/link';
import { BASE_ELEMENTS, type BaseElement } from '@/core/elements';
import { speciesFilterSchema } from '@/core/schemas/species';
import { listSpecies } from '@/db/queries/species';
import { requireAdminPage } from '@/lib/auth';
import { imageStorage } from '@/lib/storage';
import { CreatureArt, type ArtElement } from '../../creature-art';

/**
 * Species list, filterable by element and by published state.
 *
 * The filters live in the query string and are parsed with the same Zod schema
 * the rest of the app uses, so a hand-edited URL cannot widen the query beyond
 * what the schema allows.
 */
export default async function SpeciesListPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /** Guard FIRST: nothing is queried until the role has been verified. */
  await requireAdminPage();

  const query = await searchParams;
  const first = (key: string): string | undefined => {
    const value = query[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const element = first('element');
  const published = first('published');
  const search = first('q');

  const filter = speciesFilterSchema.parse({
    ...(element && BASE_ELEMENTS.includes(element as BaseElement)
      ? { baseElement: element }
      : {}),
    ...(published === 'yes' ? { isPublished: true } : {}),
    ...(published === 'no' ? { isPublished: false } : {}),
    ...(search ? { search } : {}),
  });

  const rows = await listSpecies(filter);
  const storage = imageStorage();

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: '1rem' }}>
        <h1>Especies</h1>
        <div className="row" style={{ gap: '0.5rem' }}>
          <Link className="btn" href="/admin/poderes">
            Lista de poderes
          </Link>
          <Link className="btn btn-primary" href="/admin/species/new">
            Nueva especie
          </Link>
        </div>
      </div>

      <form className="card row" method="get">
        <div className="field" style={{ flex: '1 1 200px', marginBottom: 0 }}>
          <label htmlFor="q">Buscar</label>
          <input id="q" name="q" type="search" defaultValue={search ?? ''} placeholder="nombre o slug" />
        </div>

        <div className="field" style={{ flex: '0 1 180px', marginBottom: 0 }}>
          <label htmlFor="element">Elemento</label>
          <select id="element" name="element" defaultValue={element ?? ''}>
            <option value="">todos</option>
            {BASE_ELEMENTS.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>

        <div className="field" style={{ flex: '0 1 180px', marginBottom: 0 }}>
          <label htmlFor="published">Estado</label>
          <select id="published" name="published" defaultValue={published ?? ''}>
            <option value="">todos</option>
            <option value="yes">publicadas</option>
            <option value="no">borradores</option>
          </select>
        </div>

        <button type="submit">Filtrar</button>
        <Link className="btn" href="/admin/species">
          Limpiar
        </Link>
      </form>

      <p className="small muted">
        {rows.length} especie(s){filter.baseElement ? ` · elemento ${filter.baseElement}` : ''}
        {filter.isPublished === true ? ' · publicadas' : ''}
        {filter.isPublished === false ? ' · borradores' : ''}
      </p>

      {rows.length === 0 ? (
        <div className="card">
          <p className="muted">No hay especies que coincidan con el filtro.</p>
        </div>
      ) : (
        <div className="grid">
          {rows.map((row) => (
            <article className="card species-card" key={row.id}>
              {row.baseImagePath ? (
                <img className="thumb" src={storage.urlFor(row.baseImagePath)} alt="" />
              ) : (
                <CreatureArt
                  element={(row.baseElement ?? 'none') as ArtElement}
                  name={row.name}
                  className="creature-thumb"
                />
              )}

              <div>
                <span className={`tag tag-${row.baseElement}`}>{row.baseElement}</span>{' '}
                {row.isPublished ? null : <span className="tag tag-muted">borrador</span>}
              </div>

              <strong>{row.name}</strong>
              <span className="small muted">{row.slug}</span>

              <span className="small">
                {row.baseHp} HP · {row.baseAttack} ATQ · {row.baseDefense} DEF
              </span>

              <span className="small muted">
                Vías: {row.paths.map((path) => path.targetElement).join(', ') || 'ninguna'}
              </span>

              {row.creatureCount > 0 ? (
                <span className="small muted">{row.creatureCount} kriatura(s) en juego</span>
              ) : null}

              <Link className="btn" href={`/admin/species/${row.id}`}>
                Editar
              </Link>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
