'use client';

import { useId, useState } from 'react';
import {
  CONDITION_FIELDS,
  type ConditionKey,
  EFFECT_CATALOG,
  EFFECT_TYPES,
  ELEMENTS,
  type Effect,
  type EffectType,
  blankEffect,
} from '@/core';
import {
  CONDITION_LABELS,
  EFFECT_LABELS as LABELS,
  EFFECT_NUMBER_LABELS as NUMBER_LABELS,
} from '../effect-labels';

/**
 * THE POWERS EDITOR — where a kriatura is actually built by hand.
 *
 * Effects are data, so this form is the only thing standing between eighteen
 * primitives and a roster. It submits ONE hidden field holding JSON, and the
 * server re-parses it with `effectListSchema`: nothing here is trusted, and a
 * browser that sends a hand-written payload gets exactly the validation this
 * form would have given it.
 *
 * The fields each power shows come from `EFFECT_CATALOG` rather than from a
 * switch in here, so a bound changed next to the schema reaches the form instead
 * of quietly making it offer a number the server will reject.
 */

type Draft = Record<string, unknown>;

const isCondition = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

export function EffectsEditor({
  name,
  initial,
  title,
  hint,
}: {
  name: string;
  initial?: readonly Effect[];
  title?: string;
  hint?: string;
}) {
  const baseId = useId();
  const [rows, setRows] = useState<Draft[]>(() =>
    (initial ?? []).map((effect) => ({ ...effect }) as Draft),
  );

  const patch = (index: number, change: Draft): void => {
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...change } : row)));
  };

  const setCondition = (index: number, key: ConditionKey, value: unknown): void => {
    setRows((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const condition = { ...(isCondition(row.condition) ? row.condition : {}) };
        if (value === undefined) delete condition[key];
        else condition[key] = value;
        const { condition: _dropped, ...rest } = row;
        /** An empty condition is REMOVED, not sent empty: the schema rejects {}. */
        return Object.keys(condition).length > 0 ? { ...rest, condition } : rest;
      }),
    );
  };

  return (
    <section className="card">
      <h3 style={{ marginTop: 0 }}>{title ?? 'Poderes'}</h3>
      <p className="small muted">
        {hint ??
          'El especial que sale cuando se llena la barra de maná. Cada kriatura debería tener el suyo: la variedad sale de combinar un poder con una condición.'}
      </p>

      {/* One field, validated again on the server. Effects never travel any other way. */}
      <input type="hidden" name={name} value={JSON.stringify(rows)} />

      {rows.length === 0 ? (
        <p className="small muted">Sin poderes: al llenar la barra solo hará daño básico.</p>
      ) : null}

      {rows.map((row, index) => {
        const type = String(row.type) as EffectType;
        const spec = EFFECT_CATALOG[type];
        const condition = isCondition(row.condition) ? row.condition : {};
        const conditionCount = Object.keys(condition).length;

        return (
          <div
            key={`${baseId}-${index}`}
            className="card"
            style={{ marginBottom: '0.8rem', background: 'transparent' }}
          >
            <div className="row">
              <div className="field" style={{ flex: '1 1 240px' }}>
                <label htmlFor={`${baseId}-type-${index}`}>Poder</label>
                <select
                  id={`${baseId}-type-${index}`}
                  value={type}
                  onChange={(event) =>
                    setRows((current) =>
                      current.map((old, i) =>
                        i === index ? blankEffect(event.target.value as EffectType) : old,
                      ),
                    )
                  }
                >
                  {EFFECT_TYPES.map((option) => (
                    <option key={option} value={option}>
                      {LABELS[option].name}
                    </option>
                  ))}
                </select>
                <p className="small muted">{LABELS[type].help}</p>
              </div>

              <div className="field" style={{ flex: '0 0 150px' }}>
                <label htmlFor={`${baseId}-target-${index}`}>Recae en</label>
                <select
                  id={`${baseId}-target-${index}`}
                  value={String(row.target)}
                  onChange={(event) => patch(index, { target: event.target.value })}
                >
                  <option value="enemy">el rival</option>
                  <option value="self">uno mismo</option>
                </select>
              </div>

              {spec.numbers.map((field) => (
                <div className="field" key={field.key} style={{ flex: '0 0 140px' }}>
                  <label htmlFor={`${baseId}-${field.key}-${index}`}>
                    {NUMBER_LABELS[field.key] ?? field.key}
                  </label>
                  <input
                    id={`${baseId}-${field.key}-${index}`}
                    type="number"
                    min={field.min}
                    max={field.max}
                    value={Number(row[field.key] ?? field.initial)}
                    onChange={(event) => patch(index, { [field.key]: Number(event.target.value) })}
                  />
                </div>
              ))}
            </div>

            {spec.flags.map(([flag]) => (
              <div className="checkbox" key={flag}>
                <input
                  id={`${baseId}-${flag}-${index}`}
                  type="checkbox"
                  checked={row[flag] === true}
                  style={{ width: 'auto' }}
                  onChange={(event) => patch(index, { [flag]: event.target.checked })}
                />
                <label htmlFor={`${baseId}-${flag}-${index}`}>
                  Robado: el maná pasa a tus barras
                </label>
              </div>
            ))}

            <details open={conditionCount > 0}>
              <summary className="small">
                Condición {conditionCount > 0 ? `(${conditionCount})` : '(ninguna)'}
              </summary>
              <p className="small muted">
                Todas las que marques tienen que cumplirse. Añadir una segunda hace el poder más
                raro, nunca más probable.
              </p>

              <div className="row">
                {CONDITION_FIELDS.map((field) => {
                  const required = spec.requiredCondition === field.key;
                  const on = condition[field.key] !== undefined;
                  const fieldId = `${baseId}-cond-${field.key}-${index}`;

                  return (
                    <div className="field" key={field.key} style={{ flex: '1 1 230px' }}>
                      <div className="checkbox">
                        <input
                          id={`${fieldId}-on`}
                          type="checkbox"
                          checked={on}
                          disabled={required}
                          style={{ width: 'auto' }}
                          onChange={(event) => {
                            if (!event.target.checked) {
                              setCondition(index, field.key, undefined);
                              return;
                            }
                            const started =
                              field.kind === 'element'
                                ? 'water'
                                : field.kind === 'boolean'
                                  ? true
                                  : field.initial;
                            setCondition(index, field.key, started);
                          }}
                        />
                        <label htmlFor={`${fieldId}-on`}>
                          {CONDITION_LABELS[field.key]}
                          {required ? ' (obligatoria)' : ''}
                        </label>
                      </div>

                      {on && field.kind === 'element' ? (
                        <select
                          id={fieldId}
                          value={String(condition[field.key])}
                          onChange={(event) => setCondition(index, field.key, event.target.value)}
                        >
                          {ELEMENTS.map((element) => (
                            <option key={element} value={element}>
                              {element}
                            </option>
                          ))}
                        </select>
                      ) : null}

                      {on && field.kind === 'number' ? (
                        <input
                          id={fieldId}
                          type="number"
                          min={field.min}
                          max={field.max}
                          value={Number(condition[field.key])}
                          onChange={(event) =>
                            setCondition(index, field.key, Number(event.target.value))
                          }
                        />
                      ) : null}

                      {on && field.kind === 'boolean' ? (
                        <select
                          id={fieldId}
                          value={condition[field.key] === true ? 'true' : 'false'}
                          onChange={(event) =>
                            setCondition(index, field.key, event.target.value === 'true')
                          }
                        >
                          <option value="true">sí, solo transformada</option>
                          <option value="false">no, solo sin transformar</option>
                        </select>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </details>

            <button
              className="btn-danger"
              type="button"
              onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            >
              Quitar poder
            </button>
          </div>
        );
      })}

      {rows.length >= 8 ? (
        <p className="small muted">Ocho poderes es el máximo por especie o por vía.</p>
      ) : (
        <button
          type="button"
          onClick={() => setRows((current) => [...current, blankEffect('damage')])}
        >
          Añadir poder
        </button>
      )}
    </section>
  );
}
