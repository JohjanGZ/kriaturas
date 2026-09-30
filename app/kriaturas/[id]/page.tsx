import Link from 'next/link';
import { notFound } from 'next/navigation';
import { deriveStamina } from '@/core/stamina';
import { loadGameConfig } from '@/db/queries/battle';
import { getCreatureDetail } from '@/db/queries/creature';
import { getCurrentPlayer } from '@/lib/auth';
import { CreatureArt, type ArtElement } from '../../creature-art';
import { FeedForm } from '../care-forms';

export default async function CreaturePage({ params }: { params: Promise<{ id: string }> }) {
  const player = await getCurrentPlayer();
  if (!player) notFound();

  const { id } = await params;
  const creature = await getCreatureDetail(id, player.id);
  if (!creature) notFound();

  const config = await loadGameConfig();
  const stamina = deriveStamina(creature.lastFed, new Date(), config.stamina);

  return (
    <main className="shell">
      <p className="small">
        <Link href="/kriaturas">← Mis kriaturas</Link>
      </p>

      <div className="row" style={{ alignItems: 'center', gap: '0.8rem' }}>
        <CreatureArt
          element={(creature.evolvedElement ?? creature.element ?? 'none') as ArtElement}
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
        <h2>Transformación en combate</h2>
        <p className="small muted">
          Fuera del combate una kriatura no cambia. DENTRO de una partida sí: al alinear
          drakofruta en el tablero llenas una barra, y al gastarla esta kriatura pega como
          evolucionada y cambia de aspecto — hasta que esa partida termina.
        </p>

        {creature.paths.length === 0 ? (
          <p className="small muted">Esta especie todavía no tiene vía definida.</p>
        ) : (
          creature.paths.map((path) => (
            <div
              key={path.id}
              className="card"
              style={{ marginTop: '0.8rem', opacity: path.isDefault ? 1 : 0.5 }}
            >
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <strong>{path.name}</strong>
                <span className="tag tag-muted">{path.targetElement}</span>
              </div>
              <p className="small">
                +{path.hpBonus} HP · +{path.attackBonus} ATQ · +{path.defenseBonus} DEF
                {path.isDefault ? ' · es la que usa la transformación' : ''}
              </p>
            </div>
          ))
        )}
      </section>
    </main>
  );
}
