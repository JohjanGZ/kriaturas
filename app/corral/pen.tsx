'use client';

import { useActionState, useMemo, useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import type { CorralShelf, PennedCreature } from '@/db/queries/corral';
import { AffinityFace, affinityLabel } from '../affinity-face';
import type { ArtElement } from '../creature-art';
import { CreatureFace } from '../creature-face';
import {
  type CorralActionState,
  buyCorralAction,
  checkNestAction,
  cureAction,
  feedInCorralAction,
  useStoneAction,
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
      aria-label={`${creature.name}, stamina ${creature.stamina} de ${
        creature.maxStamina
      }${creature.evolutionUnlocked ? '' : ', sin piedra: no se transforma'}`}
    >
      <span className="grazing-body">
        <CreatureFace
          imageUrl={creature.imageUrl}
          element={(creature.element ?? 'none') as ArtElement}
          name={creature.name}
          className="grazing-art"
        />
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
      {/*
        * SIN PIEDRA, una marca discreta. Lo que le falta se ve desde el corral
        * sin tener que abrir cada ficha a ver cuál es, y es una esquina y no un
        * cartel porque la kriatura funciona: solo no se transforma.
        */}
      {creature.evolutionUnlocked ? null : (
        <span className="grazing-locked" aria-hidden="true">
          ◆
        </span>
      )}
      {/* La afinidad, leída sin leer: la boca cambia de forma, no solo el color. */}
      <AffinityFace percent={creature.affinity} className="grazing-face" />
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
  const [stone, doStone] = useActionState(useStoneAction, {
    ok: false,
  } satisfies CorralActionState);
  const [nest, doNest] = useActionState(checkNestAction, {
    ok: false,
  } satisfies CorralActionState);

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
      {stone.message ? (
        <p className={`notice ${stone.ok ? 'notice-ok' : 'notice-error'}`}>{stone.message}</p>
      ) : null}
      {nest.message ? (
        <p className={`notice ${nest.ok ? 'notice-ok' : 'notice-error'}`}>{nest.message}</p>
      ) : null}

      {/*
        * EL NIDO. La probabilidad se enseña: un dado escondido no se distingue
        * de estar haciendo algo mal, y aquí lo que sube la cifra --cuidar a las
        * kriaturas-- es justo lo que queremos que el jugador entienda.
        */}
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 style={{ margin: 0 }}>El nido</h2>
          <span className="small muted">
            {shelf.nest.high} con afinidad alta · {shelf.nest.chance}% hoy
          </span>
        </div>
        <p className="small muted">
          Las kriaturas a las que cuidas y con las que juegas pueden poner un huevo. Cuantas más
          tengas contentas, más probable — con un tope del 20%.
        </p>
        {shelf.nest.checkedToday ? (
          <p className="small muted">Ya miraste hoy. Vuelve mañana.</p>
        ) : (
          <form action={doNest}>
            <Pending primary label="Mirar el nido" />
          </form>
        )}
      </section>

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
            <CreatureFace
              imageUrl={chosen.imageUrl}
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
              <div className="small" style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                <AffinityFace percent={chosen.affinity} className="care-face" />
                Afinidad {chosen.affinity}/100 — {affinityLabel(chosen.affinity)}
                {chosen.highAffinity ? ' · cuenta para el nido' : ''}
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

          {/*
            * LA PIEDRA, EN DOS PAPELES Y UN SOLO BOTÓN.
            *
            * A una kriatura corriente le ABRE LA EVOLUCIÓN: sin ella pelea
            * igual, pero no se transforma. A la blanca le hace eso Y le decide
            * el elemento de una vez, que es por lo que son cuatro botones ahí y
            * uno aquí: la blanca ELIGE — sortearlo la convertiría en lotería —
            * y la corriente solo puede fusionar la de su propio elemento.
            *
            * Fusionada no se dice nada: un aviso permanente de algo que ya está
            * resuelto es ruido. Solo se habla cuando falta.
            */}
          {chosen.evolutionUnlocked ? null : chosen.element === null ? (
            <>
              <p className="small muted">
                Nació en blanco. Una <strong>piedra elemental</strong> decide qué es, y hasta
                entonces no puede pelear. La elección es permanente, y la misma piedra le abre
                la transformación.
              </p>
              <div className="row" style={{ gap: '0.4rem', flexWrap: 'wrap' }}>
                {(['fire', 'water', 'plant', 'psychic'] as const).map((element) => (
                  <form key={element} action={doStone}>
                    <input type="hidden" name="creatureId" value={chosen.id} />
                    <input type="hidden" name="element" value={element} />
                    <Pending
                      primary={shelf.freeStones > 0 || shelf.coins >= chosen.stonePrice}
                      label={
                        shelf.freeStones > 0
                          ? `${element} · gratis`
                          : `${element} · ${chosen.stonePrice}`
                      }
                    />
                  </form>
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="small muted">
                Pelea, pero <strong>no se transforma</strong>: le falta fusionar una{' '}
                <strong>piedra de {chosen.element}</strong>. Cada kriatura necesita la de su
                propio elemento.
              </p>
              <form action={doStone}>
                <input type="hidden" name="creatureId" value={chosen.id} />
                <input type="hidden" name="element" value={chosen.element} />
                <Pending
                  primary={shelf.freeStones > 0 || shelf.coins >= chosen.stonePrice}
                  label={
                    shelf.freeStones > 0
                      ? `Fusionar piedra · gratis (te queda ${shelf.freeStones})`
                      : `Fusionar piedra de ${chosen.element} · ${chosen.stonePrice} monedas`
                  }
                />
              </form>
            </>
          )}

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
