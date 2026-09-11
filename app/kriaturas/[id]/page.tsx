import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deriveStamina } from '@/core/stamina';
import { loadGameConfig } from '@/db/queries/battle';
import { getCreatureDetail } from '@/db/queries/creature';
import { getCurrentPlayer } from '@/lib/auth';
import { CreatureArt, type ArtElement } from '../../creature-art';
import { ChoosePathForm, EvolveForm, FeedForm } from '../care-forms';

export default async function CreaturePage({ params }: { params: Promise<{ id: string }> }) {
  const player = await getCurrentPlayer();
  if (!player) notFound();

  const { id } = await params;
  const creature = await getCreatureDetail(id, player.id);
  if (!creature) notFound();

  const config = await loadGameConfig();
  const stamina = deriveStamina(creature.lastFed, new Date(), config.stamina);

  const chosen = creature.paths.find((path) => path.id === creature.chosenPathId) ?? null;
  const canAfford = creature.playerFruits >= creature.fruitCost;

  /** The path the evolve button would actually take. */
  const target = chosen ?? (creature.paths.length === 1 ? creature.paths[0] : null);
  const requirementsMet = target?.allRequirementsMet ?? false;
  const canEvolve = !creature.isEvolved && target !== null && requirementsMet && canAfford;

  const hint = creature.isEvolved
    ? 'Ya evolucionó. Es permanente.'
    : target === null
      ? 'Elige primero una vía.'
      : !requirementsMet
        ? 'Faltan objetivos por cumplir.'
        : !canAfford
          ? `Necesitas ${creature.fruitCost} de drakofruta y tienes ${creature.playerFruits}.`
          : `Gastarás ${creature.fruitCost} de drakofruta. No se puede deshacer.`;

  return (
    <main className="shell">
      <p className="small">
        <Link href="/kriaturas">← Mis kriaturas</Link>
      </p>

      <div className="row" style={{ alignItems: 'center', gap: '0.8rem' }}>
        <CreatureArt
          element={creature.element as ArtElement}
          name={creature.name}
          style={{ width: 90, height: 90, flex: '0 0 auto' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 style={{ margin: 0 }}>{creature.name}</h1>
          <span className={`tag tag-${creature.element}`}>{creature.element}</span>
        </div>
      </div>
      <p className="small muted">
        {creature.speciesName} · ataque {creature.attack} · maná {creature.manaCost} · HP de
        especie {creature.hp}
      </p>

      <section className="card">
        <h2>Stamina</h2>
        <div className="bar">
          <div
            className="bar-fill"
            style={{
              width: `${Math.round((stamina.current / stamina.max) * 100)}%`,
              background: 'var(--ok)',
            }}
          />
          <span className="bar-text">
            {stamina.current}/{stamina.max}
          </span>
        </div>
        <p className="small muted">
          Se regenera sola: +1 cada {Math.round(config.stamina.regenSeconds / 60)} min. Nunca baja
          por estar ausente, solo por jugar. Cada partida cuesta{' '}
          {config.play.staminaCostPerMatch}.
        </p>
        <FeedForm
          creatureId={creature.id}
          food={creature.playerFood}
          isFull={stamina.isFull}
        />
      </section>

      <section className="card">
        <h2>Evolución</h2>
        {creature.isEvolved ? (
          <p className="notice notice-ok">
            Ya evolucionó por la vía <strong>{chosen?.targetElement}</strong>. Es permanente e
            irreversible.
          </p>
        ) : chosen ? (
          <p className="small muted">
            Vía elegida: <strong>{chosen.name}</strong> → {chosen.targetElement}. La elección es
            permanente; solo falta cumplir y pagar.
          </p>
        ) : (
          <p className="small muted">
            Elige una vía. Una vez elegida no se puede cambiar, así que mira bien los requisitos.
          </p>
        )}

        {creature.paths.map((path) => {
          const isChosen = path.id === creature.chosenPathId;
          const dimmed = creature.chosenPathId !== null && !isChosen;
          return (
            <div
              key={path.id}
              className="card"
              style={{ opacity: dimmed ? 0.45 : 1, marginTop: '0.8rem' }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{path.name}</strong>
                <span className="tag tag-muted">{path.targetElement}</span>
              </div>
              <p className="small">
                +{path.hpBonus} HP · +{path.attackBonus} ATQ · +{path.defenseBonus} DEF
                {path.isDefault ? ' · por defecto' : ''}
              </p>

              {path.requirements.length === 0 ? (
                <p className="small muted">Sin requisitos.</p>
              ) : (
                <ul className="small" style={{ paddingLeft: '1.1rem', margin: '0.4rem 0' }}>
                  {path.requirements.map((req) => (
                    <li key={req.objectiveId}>
                      {req.completed ? '✅' : '⬜'} {req.name} — {Math.min(req.current, req.target)}/
                      {req.target}
                    </li>
                  ))}
                </ul>
              )}

              {!creature.isEvolved && creature.chosenPathId === null ? (
                <ChoosePathForm
                  creatureId={creature.id}
                  pathId={path.id}
                  label={`Elegir ${path.targetElement}`}
                />
              ) : null}
            </div>
          );
        })}

        {creature.isEvolved ? null : (
          <div style={{ marginTop: '1rem' }}>
            <EvolveForm
              creatureId={creature.id}
              pathId={target?.id ?? null}
              disabled={!canEvolve}
              hint={hint}
            />
          </div>
        )}
      </section>
    </main>
  );
}
