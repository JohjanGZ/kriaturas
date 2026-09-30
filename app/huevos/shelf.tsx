'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { EggShelf } from '@/db/queries/egg';
import {
  type EggActionState,
  buyEggAction,
  buyIncubatorAction,
  hatchEggAction,
  moveEggAction,
  powerEggAction,
} from './actions';

/**
 * LA INCUBADORA.
 *
 * Everything on screen is derived on the server for this render: how many days
 * an egg has lived, how many are already paid for, what the next recharge
 * costs. Nothing here computes a price or a date — it only draws what the
 * server decided and sends back an id.
 *
 * What the egg CONTAINS is not here at all. It was rolled at purchase and no
 * query returns it until the thing hatches.
 */

function Pending({ label, primary }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={primary ? 'btn-primary' : ''} type="submit" disabled={pending}>
      {pending ? '…' : label}
    </button>
  );
}

function Notice({ state }: { state: EggActionState }) {
  if (!state.message) return null;
  return (
    <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>
  );
}

function EggCard({ egg, shelf }: { egg: EggShelf['eggs'][number]; shelf: EggShelf }) {
  const [power, payPower] = useActionState(powerEggAction, { ok: false } satisfies EggActionState);
  const [hatch, doHatch] = useActionState(hatchEggAction, { ok: false } satisfies EggActionState);
  const [move, doMove] = useActionState(moveEggAction, { ok: false } satisfies EggActionState);

  if (egg.status === 'hatched') {
    return (
      <article className="card egg-card">
        <span className="egg-shell egg-open" aria-hidden="true">
          🐣
        </span>
        <strong>{egg.speciesName}</strong>
        <span className="small muted">Salió de un {egg.typeName}</span>
      </article>
    );
  }

  const done = egg.poweredDays;
  const total = egg.careDaysRequired;
  const free = shelf.incubators.filter(
    (incubator) => incubator.eggId === null || incubator.eggId === egg.id,
  );

  return (
    <article className="card egg-card">
      <span className="egg-shell" aria-hidden="true">
        🥚
      </span>
      <strong>{egg.typeName}</strong>

      {/*
        * Los días CON ENERGÍA, uno a uno. Un "2/3" se lee como una fracción; tres
        * casillas se leen como lo que falta. Las pagadas que aún no han llegado
        * se dibujan a medias: ya son tuyas, pero todavía no han pasado.
        */}
      <span className="egg-days" aria-label={`${done} de ${total} días con energía`}>
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className={`egg-day${index < done ? ' egg-day-on' : index < done + egg.chargedAhead ? ' egg-day-paid' : ''}`}
          />
        ))}
      </span>

      <span className="small muted">
        {done}/{total} días con energía
        {egg.chargedAhead > 0 ? ` · ${egg.chargedAhead} ya pagado(s)` : ''}
      </span>

      <Notice state={power} />
      <Notice state={hatch} />
      <Notice state={move} />

      {egg.readyToHatch ? (
        <form action={doHatch}>
          <input type="hidden" name="eggId" value={egg.id} />
          <Pending primary label="¡Abrirlo!" />
        </form>
      ) : egg.incubator === null ? (
        <>
          <p className="small muted">
            Fuera de la incubadora no avanza. Métela en una para poder darle energía.
          </p>
          {free.length > 0 ? (
            <form action={doMove}>
              <input type="hidden" name="eggId" value={egg.id} />
              <input type="hidden" name="incubatorId" value={free[0]?.id ?? ''} />
              <Pending label={`Meter en ${free[0]?.name}`} />
            </form>
          ) : (
            <p className="small muted">No tienes ninguna incubadora libre.</p>
          )}
        </>
      ) : (
        <>
          <span className="small muted">
            En {egg.incubator.name} · batería de {egg.incubator.capacityDays} día(s)
          </span>

          {egg.payableDays > 0 ? (
            <form action={payPower}>
              <input type="hidden" name="eggId" value={egg.id} />
              <input type="hidden" name="days" value={egg.payableDays} />
              <Pending
                primary
                label={`Pagar ${egg.payableDays} día(s) · ${egg.payableCost} monedas`}
              />
            </form>
          ) : (
            <p className="small muted">
              Batería llena. Vuelve mañana: los días que pagaste van llegando solos.
            </p>
          )}
        </>
      )}
    </article>
  );
}

export function Shelf({ shelf }: { shelf: EggShelf }) {
  const [buy, doBuy] = useActionState(buyEggAction, { ok: false } satisfies EggActionState);
  const [gear, doGear] = useActionState(buyIncubatorAction, {
    ok: false,
  } satisfies EggActionState);

  const active = shelf.eggs.filter((egg) => egg.status === 'incubating');
  const daily = active.reduce(
    (total, egg) => total + (egg.incubator ? egg.electricityCost : 0),
    0,
  );

  return (
    <>
      <p className="small muted">
        Monedas: <strong>{shelf.coins}</strong>
        {daily > 0 ? ` · la luz de todos tus huevos cuesta ${daily} al día` : ''}
      </p>

      <Notice state={buy} />
      <Notice state={gear} />

      <section className="card">
        <h2>Tus huevos</h2>
        {shelf.eggs.length === 0 ? (
          <p className="small muted">
            Todavía no tienes ninguno. Compra uno abajo: no sabrás qué hay dentro hasta que se
            abra.
          </p>
        ) : (
          <div className="grid">
            {shelf.eggs.map((egg) => (
              <EggCard key={egg.id} egg={egg} shelf={shelf} />
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Comprar un huevo</h2>
        <p className="small muted">
          Cuesta monedas al comprarlo y monedas cada día que la incubadora está encendida. Si no
          pagas la luz, el huevo <strong>se queda quieto</strong> — nunca se estropea.
        </p>
        <div className="grid">
          {shelf.types.map((type) => (
            <form key={type.id} action={doBuy} className="card egg-card">
              <input type="hidden" name="eggTypeId" value={type.id} />
              <strong>{type.name}</strong>
              {type.description ? (
                <span className="small muted">{type.description}</span>
              ) : null}
              <span className="small">
                {type.priceAmount} monedas · {type.careDaysRequired} días · luz{' '}
                {type.electricityCost}/día
              </span>
              <span className="small muted">
                Total: {type.priceAmount + type.careDaysRequired * type.electricityCost} monedas
              </span>
              <Pending
                primary={shelf.coins >= type.priceAmount}
                label={shelf.coins >= type.priceAmount ? 'Comprar' : 'No te alcanza'}
              />
            </form>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>Incubadoras</h2>
        <p className="small muted">
          Lo que cambia es la <strong>batería</strong>: cuántos días puedes pagar de una vez. La
          básica aguanta uno, así que hay que volver cada día. Las otras te dejan pagarlo todo y
          olvidarte. Ninguna protege al huevo de nada — no hay de qué protegerlo.
        </p>

        <ul className="small">
          {shelf.incubators.map((incubator) => (
            <li key={incubator.id}>
              {incubator.name} — batería de {incubator.capacityDays} día(s)
              {incubator.eggId ? ' · ocupada' : ' · libre'}
            </li>
          ))}
        </ul>

        <div className="row" style={{ gap: '0.6rem', flexWrap: 'wrap' }}>
          {shelf.forSale.map((offer) => (
            <form key={offer.capacityDays} action={doGear}>
              <input type="hidden" name="capacityDays" value={offer.capacityDays} />
              <Pending label={`Batería de ${offer.capacityDays} días · ${offer.priceCoins}`} />
            </form>
          ))}
        </div>
      </section>
    </>
  );
}
