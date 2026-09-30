'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import type { CorralShelf, PennedCreature } from '@/db/queries/corral';
import { CreatureArt, type ArtElement } from '../creature-art';
import {
  type CorralActionState,
  buyCorralAction,
  cureAction,
  feedInCorralAction,
} from './actions';

/**
 * EL CORRAL.
 *
 * Las kriaturas van a ser IMÁGENES FIJAS, así que aquí no se anima el dibujo:
 * se anima su SITIO. Tres cosas bastan para que un solo fotograma pasee:
 *
 *  1. una deriva lenta de un lado a otro del cercado,
 *  2. un balanceo corto arriba y abajo — la respiración,
 *  3. y el VOLTEO horizontal al cambiar de sentido, que es lo que de verdad
 *     vende el paseo: sin él la kriatura parece arrastrada hacia atrás.
 *
 * Cada una arranca en un punto distinto del ciclo, con su propia duración, para
 * que no vayan todas a la vez como un coro. Los números salen de su id: son
 * estables entre renders, así que una kriatura no salta de sitio cuando la
 * página se vuelve a dibujar.
 */

function Pending({ label, primary }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={primary ? 'btn-primary' : ''} type="submit" disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

/** Estable a partir del id: el mismo bicho siempre pasea igual. */
function wanderOf(id: string): { lane: number; delay: number; duration: number; bob: number } {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) % 100_000;
  return {
    lane: 6 + (hash % 62),
    delay: -(hash % 17),
    duration: 16 + (hash % 13),
    bob: 2.4 + ((hash >> 3) % 14) / 10,
  };
}

function Grazing({
  creature,
  selected,
  onSelect,
}: {
  creature: PennedCreature;
  selected: boolean;
  onSelect: () => void;
}) {
  const wander = useMemo(() => wanderOf(creature.id), [creature.id]);
  const share = Math.round((creature.stamina / creature.maxStamina) * 100);

  return (
    <button
      type="button"
      className={`grazing${selected ? ' grazing-on' : ''}${
        creature.rested ? '' : ' grazing-tired'
      }${creature.sickSince ? ' grazing-sick' : ''}`}
      style={
        {
          '--lane': `${wander.lane}%`,
          '--wander-delay': `${wander.delay}s`,
          '--wander-ms': `${wander.duration}s`,
          '--bob-ms': `${wander.bob}s`,
        } as React.CSSProperties
      }
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`${creature.name}, stamina ${creature.stamina} de ${creature.maxStamina}`}
    >
      <span className="grazing-body">
        {creature.imageUrl ? (
          <img className="grazing-art" src={creature.imageUrl} alt="" />
        ) : (
          <CreatureArt
            element={(creature.element ?? 'none') as ArtElement}
            name={creature.name}
            className="grazing-art"
          />
        )}
      </span>

      {/* La barra no pasea con el bicho: se queda quieta bajo él y se lee. */}
      <span className="grazing-bar" aria-hidden="true">
        <span
          className={`grazing-fill${creature.rested ? '' : ' grazing-fill-low'}`}
          style={{ width: `${share}%` }}
        />
      </span>
      {/* Se ve que está mala antes de leer nada: se para, se apaga y avisa. */}
      {creature.sickSince ? (
        <span className="grazing-sick-mark" aria-hidden="true">
          🤒
        </span>
      ) : null}
      <span className="grazing-name">{creature.name}</span>
    </button>
  );
}

export function Pen({ shelf }: { shelf: CorralShelf }) {
  const [picked, setPicked] = useState<string | null>(null);
  const [feed, doFeed] = useActionState(feedInCorralAction, {
    ok: false,
  } satisfies CorralActionState);
  const [buy, doBuy] = useActionState(buyCorralAction, { ok: false } satisfies CorralActionState);
  const [cure, doCure] = useActionState(cureAction, { ok: false } satisfies CorralActionState);

  const everyone = [...shelf.corrals.flatMap((pen) => pen.creatures), ...shelf.loose];
  const chosen = everyone.find((creature) => creature.id === picked) ?? null;

  return (
    <>
      <p className="small muted">
        {shelf.used}/{shelf.total} plazas ocupadas · comida <strong>{shelf.food}</strong> ·
        monedas <strong>{shelf.coins}</strong>
      </p>

      {feed.message ? (
        <p className={`notice ${feed.ok ? 'notice-ok' : 'notice-error'}`}>{feed.message}</p>
      ) : null}
      {buy.message ? (
        <p className={`notice ${buy.ok ? 'notice-ok' : 'notice-error'}`}>{buy.message}</p>
      ) : null}
      {cure.message ? (
        <p className={`notice ${cure.ok ? 'notice-ok' : 'notice-error'}`}>{cure.message}</p>
      ) : null}

      {shelf.corrals.map((pen) => (
        <section key={pen.id} className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
            <h2 style={{ margin: 0 }}>{pen.name}</h2>
            <span className="small muted">
              {pen.creatures.length}/{pen.capacity} plazas
            </span>
          </div>

          <div className="pen">
            {pen.creatures.length === 0 ? (
              <p className="pen-empty small muted">Vacío. Aquí caerán las que eclosionen.</p>
            ) : (
              pen.creatures.map((creature) => (
                <Grazing
                  key={creature.id}
                  creature={creature}
                  selected={creature.id === picked}
                  onSelect={() => setPicked(creature.id === picked ? null : creature.id)}
                />
              ))
            )}
          </div>
        </section>
      ))}

      {shelf.loose.length > 0 ? (
        <section className="card">
          <h2>Sueltas</h2>
          <p className="small muted">
            Nacieron antes de que existieran los corrales. Entrarán en uno en cuanto haya sitio.
          </p>
          <div className="pen">
            {shelf.loose.map((creature) => (
              <Grazing
                key={creature.id}
                creature={creature}
                selected={creature.id === picked}
                onSelect={() => setPicked(creature.id === picked ? null : creature.id)}
              />
            ))}
          </div>
        </section>
      ) : null}

      {/*
        * AL SELECCIONAR, LA FICHA. Va abajo y fija: si saliera flotando sobre el
        * corral taparía justo lo que acabas de tocar, y en un móvil el pulgar ya
        * está en esa mitad de la pantalla.
        */}
      {chosen ? (
        <section className="card care-card">
          <div className="row" style={{ alignItems: 'center', gap: '0.7rem' }}>
            <CreatureArt
              element={(chosen.element ?? 'none') as ArtElement}
              name={chosen.name}
              className="creature-thumb"
            />
            <div>
              <strong>{chosen.name}</strong>
              {chosen.isExcellent ? <span className="tag tag-excellent"> ✦</span> : null}
              <div className="small muted">
                {chosen.speciesName} ·{' '}
                {chosen.element ?? 'sin elemento — necesita una piedra'}
              </div>
              <div className="small">
                Ataque {chosen.attack} · maná {chosen.manaCost}
                {chosen.attackDelta !== 0 || chosen.manaCostDelta !== 0 ? (
                  <span className="season-tuned"> · ajustada esta temporada</span>
                ) : null}
              </div>
              <div className="small">
                Stamina {chosen.stamina}/{chosen.maxStamina}
                {chosen.sickSince
                  ? ' — enferma, con el techo bajo'
                  : chosen.rested
                    ? ''
                    : ' — demasiado cansada para jugar'}
              </div>
            </div>
          </div>

          {chosen.sickSince ? (
            <p className="small muted">
              Enfermó por quedarse seca. No puede pelear hasta curarla — y darle de comer ya no
              le sube la barra más allá de su techo.
            </p>
          ) : null}

          <div className="row" style={{ gap: '0.5rem', flexWrap: 'wrap' }}>
            {chosen.sickSince ? (
              <form action={doCure}>
                <input type="hidden" name="creatureId" value={chosen.id} />
                <Pending
                  primary={shelf.coins >= chosen.curePrice}
                  label={
                    shelf.coins >= chosen.curePrice
                      ? `Curar · ${chosen.curePrice} monedas`
                      : `Curar cuesta ${chosen.curePrice}`
                  }
                />
              </form>
            ) : null}
            <form action={doFeed}>
              <input type="hidden" name="creatureId" value={chosen.id} />
              <input type="hidden" name="foodUnits" value={1} />
              <Pending primary label={shelf.food > 0 ? 'Cuidar' : 'Sin comida'} />
            </form>
            <Link className="btn" href={`/kriaturas/${chosen.id}`}>
              Ver ficha
            </Link>
          </div>
        </section>
      ) : (
        <p className="small muted">Toca una kriatura para cuidarla.</p>
      )}

      <section className="card">
        <h2>Más corrales</h2>
        <p className="small muted">
          Cuando no quedan plazas, un huevo listo <strong>espera</strong> en vez de eclosionar.
          Nada se pierde y nada se borra: solo hace falta sitio.
        </p>
        <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
          {shelf.forSale.map((offer) => (
            <form key={offer.capacity} action={doBuy}>
              <input type="hidden" name="capacity" value={offer.capacity} />
              <Pending label={`${offer.capacity} plazas · ${offer.priceCoins} monedas`} />
            </form>
          ))}
        </div>
      </section>
    </>
  );
}
