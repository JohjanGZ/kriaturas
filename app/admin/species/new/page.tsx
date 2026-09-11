import Link from 'next/link';
import { requireAdminPage } from '@/lib/auth';
import { createSpeciesAction } from '../actions';
import { SpeciesForm } from '../species-form';

export default async function NewSpeciesPage() {
  await requireAdminPage();

  return (
    <>
      <p className="small">
        <Link href="/admin/species">← Especies</Link>
      </p>
      <h1>Nueva especie</h1>
      <p className="small muted">
        Al guardar se crea también su vía de evolución por defecto, derivada del elemento base.
      </p>
      <SpeciesForm action={createSpeciesAction} submitLabel="Crear especie" />
    </>
  );
}
