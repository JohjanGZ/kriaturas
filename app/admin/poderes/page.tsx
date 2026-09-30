import Link from 'next/link';
import { CONDITION_FIELDS, EFFECT_CATALOG } from '@/core/effects/catalog';
import { EFFECT_TYPES } from '@/core/effects/schema';
import { requireAdminPage } from '@/lib/auth';
import { CONDITION_LABELS, EFFECT_LABELS, EFFECT_NUMBER_LABELS } from '../effect-labels';

/**
 * THE POWER LIST, as reference.
 *
 * It is generated from `EFFECT_CATALOG`, never typed out: a list of powers
 * written by hand goes stale the first time one is added, and a stale reference
 * is worse than none — it is the document someone designs a creature against.
 */
export default async function PowersPage() {
  await requireAdminPage();

  const range = (key: string, min: number, max: number): string =>
    `${EFFECT_NUMBER_LABELS[key] ?? key} ${min}–${max}`;

  return (
    <>
      <p className="small">
        <Link href="/admin/species">← Especies</Link>
      </p>

      <h1>Poderes</h1>
      <p className="small muted">
        {EFFECT_TYPES.length} poderes y {CONDITION_FIELDS.length} condiciones. La variedad sale de
        cruzarlos: el mismo poder detrás de una condición distinta ya es otra kriatura, y cada una
        debería tener su propia combinación.
      </p>

      <table>
        <thead>
          <tr>
            <th>Poder</th>
            <th>Qué hace</th>
            <th>Campos</th>
          </tr>
        </thead>
        <tbody>
          {EFFECT_TYPES.map((type) => {
            const spec = EFFECT_CATALOG[type];
            return (
              <tr key={type}>
                <td>
                  <strong>{EFFECT_LABELS[type].name}</strong>
                  <div className="small muted">{type}</div>
                </td>
                <td className="small">
                  {EFFECT_LABELS[type].help}
                  {spec.requiredCondition ? (
                    <div className="small muted">
                      Necesita la condición «{CONDITION_LABELS[spec.requiredCondition]}».
                    </div>
                  ) : null}
                </td>
                <td className="small">
                  {spec.numbers.length === 0 && spec.flags.length === 0
                    ? 'ninguno'
                    : [
                        ...spec.numbers.map((field) => range(field.key, field.min, field.max)),
                        ...spec.flags.map(([flag]) => flag),
                      ].join(' · ')}
                  <div className="small muted">
                    por defecto recae en {spec.defaultTarget === 'enemy' ? 'el rival' : 'uno mismo'}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <section className="card">
        <h2>Condiciones</h2>
        <p className="small muted">
          Opcionales y acumulables: todas las que pongas tienen que cumplirse, así que una segunda
          condición hace el poder más raro, nunca más probable.
        </p>
        <table>
          <thead>
            <tr>
              <th>Condición</th>
              <th>Clave</th>
              <th>Rango</th>
            </tr>
          </thead>
          <tbody>
            {CONDITION_FIELDS.map((field) => (
              <tr key={field.key}>
                <td className="small">{CONDITION_LABELS[field.key]}</td>
                <td className="small muted">{field.key}</td>
                <td className="small">
                  {field.kind === 'number'
                    ? `${field.min}–${field.max}`
                    : field.kind === 'element'
                      ? 'un elemento'
                      : 'sí / no'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
