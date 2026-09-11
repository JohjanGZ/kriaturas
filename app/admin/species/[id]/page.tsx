import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { BaseElement } from '@/core/elements';
import { creaturesOnPath } from '@/db/queries/evolution';
import { getSpecies } from '@/db/queries/species';
import { requireAdminPage } from '@/lib/auth';
import { imageStorage } from '@/lib/storage';
import { updateSpeciesAction } from '../actions';
import { DeleteSpecies } from '../delete-species';
import { type PathView, PathEditor } from '../path-editor';
import { SpeciesForm } from '../species-form';

export default async function EditSpeciesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdminPage();

  const { id } = await params;
  const species = await getSpecies(id);
  if (!species) notFound();

  const storage = imageStorage();

  const paths: PathView[] = await Promise.all(
    species.paths.map(async (path) => ({
      id: path.id,
      targetElement: path.targetElement,
      name: path.name,
      isDefault: path.isDefault,
      hpBonus: path.hpBonus,
      attackBonus: path.attackBonus,
      defenseBonus: path.defenseBonus,
      imageUrl: path.imagePath ? storage.urlFor(path.imagePath) : null,
      creatureCount: await creaturesOnPath(path.id),
    })),
  );

  return (
    <>
      <p className="small">
        <Link href="/admin/species">← Especies</Link>
      </p>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h1>{species.name}</h1>
        <span className={`tag tag-${species.baseElement}`}>{species.baseElement}</span>
      </div>

      <SpeciesForm
        action={updateSpeciesAction}
        submitLabel="Guardar cambios"
        species={{
          id: species.id,
          name: species.name,
          slug: species.slug,
          baseElement: species.baseElement as BaseElement,
          baseImageUrl: species.baseImagePath ? storage.urlFor(species.baseImagePath) : null,
          baseHp: species.baseHp,
          baseAttack: species.baseAttack,
          baseDefense: species.baseDefense,
          manaCost: species.manaCost,
          description: species.description,
          isPublished: species.isPublished,
        }}
      />

      <PathEditor speciesId={species.id} paths={paths} />

      <section className="card">
        <h2>Zona peligrosa</h2>
        <p className="small muted">
          {species.creatureCount > 0
            ? `Hay ${species.creatureCount} kriatura(s) de esta especie. La base de datos impide borrarla mientras existan.`
            : 'Nadie tiene kriaturas de esta especie todavía.'}
        </p>
        <DeleteSpecies id={species.id} disabled={species.creatureCount > 0} />
      </section>
    </>
  );
}
