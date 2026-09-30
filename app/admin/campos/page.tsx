import Link from 'next/link';
import { listFieldSettings } from '@/db/queries/field';
import { requireAdminPage } from '@/lib/auth';
import { imageStorage } from '@/lib/storage';
import { FieldForm, type FieldView } from './field-form';

/**
 * The ten fields, editable.
 *
 * What is editable is deliberately narrow: a name, a sentence, an icon, a
 * background, whether it comes up and how often. The RULE stays in code, so
 * nothing on this page can invent an eleventh field or turn the whirlwind into
 * something else — which is exactly why it is safe to hand this screen to
 * whoever is tuning the game.
 */
export default async function FieldsPage() {
  /** Guard FIRST: nothing is queried until the role has been verified. */
  await requireAdminPage();

  const fields = await listFieldSettings();
  const storage = imageStorage();

  const views: FieldView[] = fields.map((field) => ({
    kind: field.kind,
    name: field.name,
    rule: field.rule,
    icon: field.icon,
    isEnabled: field.isEnabled,
    weight: field.weight,
    imageUrl: field.imagePath ? storage.urlFor(field.imagePath) : null,
  }));

  const enabled = views.filter((field) => field.isEnabled);
  const total = enabled.reduce((sum, field) => sum + field.weight, 0);

  return (
    <>
      <p className="small">
        <Link href="/admin/species">← Especies</Link>
      </p>

      <h1>Campos</h1>
      <p className="small muted">
        El terreno se sortea al empezar una partida en modo campo. Aquí se edita cómo se
        presenta — nombre, frase, icono y fondo — y si entra en el sorteo. <strong>La regla que
        aplica está en el código</strong>: esto no puede convertir un campo en otro.
      </p>

      {enabled.length === 0 ? (
        <p className="notice notice-error">
          No hay ningún campo activo: el modo campo no tendría nada que sortear y caería siempre
          en el remolino.
        </p>
      ) : (
        <p className="small muted">
          {enabled.length} de {views.length} pueden salir. Las probabilidades se reparten por
          frecuencia sobre un total de {total}.
        </p>
      )}

      <div className="row" style={{ gap: '0.8rem', alignItems: 'stretch', flexWrap: 'wrap' }}>
        {views.map((field) => (
          <FieldForm key={field.kind} field={field} />
        ))}
      </div>
    </>
  );
}
