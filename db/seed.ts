import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { CANONICAL_EVOLUTIONS, type BaseElement } from '@/core/elements';
import { DEFAULT_CONFIG, CONFIG_KEYS, type ConfigKey } from '@/core/schemas/config';
import { parseEffectList } from '@/core/effects/schema';
import { parseObjectiveParams } from '@/core/schemas/objectives';
import { initialAnchor } from '@/core/stamina';
import { type Db, createConnection } from './client';
import {
  creatures,
  eggTypeSpecies,
  eggTypes,
  evolutionPaths,
  evolutionRequirements,
  gameConfigs,
  games,
  objectives,
  players,
  species,
  users,
} from './schema';

/**
 * Seeds a playable local database.
 *
 * Idempotent: every insert either conflicts harmlessly or updates in place, so
 * running it twice is safe and re-running after a schema change is the normal
 * way to refresh local data.
 *
 * Everything the seed writes goes through the same validation the app uses —
 * effects and objective params are parsed with their Zod schemas before they
 * reach the database, so the seed cannot smuggle in a shape the app would reject.
 */

const ADMIN_EMAIL = 'admin@kriaturas.local';
const GAME_SLUG = 'kriaturas';

type SpeciesSeed = {
  slug: string;
  name: string;
  baseElement: BaseElement;
  hp: number;
  attack: number;
  defense: number;
  description: string;
  manaCost: number;
  effects: unknown[];
  /** Extra branches beyond the canonical one. */
  extraPaths?: { targetElement: 'rock'; name: string; attackBonus: number }[];
};

const SPECIES_SEED: SpeciesSeed[] = [
  {
    slug: 'brasilla',
    manaCost: 10,
    name: 'Brasilla',
    baseElement: 'fire',
    hp: 30,
    attack: 12,
    defense: 5,
    description: 'Cría de brasa inquieta. Se enciende con cada combo.',
    effects: [{ type: 'damage', target: 'enemy', value: 20 }],
  },
  {
    slug: 'pirox',
    manaCost: 16,
    name: 'Pirox',
    baseElement: 'fire',
    hp: 34,
    attack: 14,
    defense: 6,
    description: 'Guardián de ceniza. Golpea más fuerte en cadenas largas.',
    effects: [
      { type: 'damage', target: 'enemy', value: 18 },
      { type: 'combo_bonus', target: 'self', value: 40, condition: { min_combo: 4 } },
    ],
  },
  {
    slug: 'gotina',
    manaCost: 8,
    name: 'Gotina',
    baseElement: 'water',
    hp: 32,
    attack: 9,
    defense: 8,
    description: 'Gota viajera. Cura al equipo mientras fluye.',
    effects: [{ type: 'heal', target: 'self', value: 12 }],
  },
  {
    slug: 'marelo',
    manaCost: 14,
    name: 'Marelo',
    baseElement: 'water',
    hp: 38,
    attack: 8,
    defense: 12,
    description: 'Caparazón de marea. Levanta escudos que aguantan turnos.',
    effects: [{ type: 'shield', target: 'self', value: 14, duration_turns: 2 }],
  },
  {
    slug: 'retono',
    manaCost: 12,
    name: 'Retoño',
    baseElement: 'plant',
    hp: 35,
    attack: 10,
    defense: 9,
    description: 'Brote terco. Puede endurecerse en roca o destilar veneno.',
    effects: [
      {
        type: 'damage_by_type',
        target: 'enemy',
        value: 30,
        condition: { enemy_element: 'water' },
      },
    ],
    extraPaths: [{ targetElement: 'rock', name: 'Vía roca', attackBonus: 4 }],
  },
  {
    slug: 'cactel',
    manaCost: 11,
    name: 'Cactel',
    baseElement: 'plant',
    hp: 33,
    attack: 11,
    defense: 10,
    description: 'Espinas pacientes. Devuelve el daño que recibe.',
    effects: [{ type: 'damage', target: 'enemy', value: 22 }],
  },
  {
    slug: 'mentix',
    manaCost: 18,
    name: 'Mentix',
    baseElement: 'psychic',
    hp: 28,
    attack: 15,
    defense: 4,
    description: 'Mirada fija. Frágil, pero pega como un martillo.',
    effects: [{ type: 'damage', target: 'enemy', value: 26 }],
  },
  {
    slug: 'onirio',
    manaCost: 13,
    name: 'Onirio',
    baseElement: 'psychic',
    hp: 31,
    attack: 13,
    defense: 6,
    description: 'Tejedor de sueños. Se refuerza tras evolucionar.',
    effects: [
      { type: 'damage', target: 'enemy', value: 16 },
      { type: 'damage', target: 'enemy', value: 14, condition: { self_evolved: true } },
    ],
  },
];

type ObjectiveSeed = {
  code: string;
  name: string;
  description: string;
  metric: Parameters<typeof parseObjectiveParams>[0];
  scope: 'creature' | 'player';
  targetValue: number;
  params: Record<string, unknown>;
};

const OBJECTIVE_SEED: ObjectiveSeed[] = [
  {
    code: 'win_10_matches',
    name: 'Gana 10 partidas',
    description: 'Gana diez partidas con esta kriatura.',
    metric: 'matches_won',
    scope: 'creature',
    targetValue: 10,
    params: {},
  },
  {
    code: 'clear_500_plant_gems',
    name: 'Rompe 500 gemas planta',
    description: 'Elimina quinientas gemas de planta con esta kriatura.',
    metric: 'element_gems_cleared',
    scope: 'creature',
    targetValue: 500,
    params: { element: 'plant' },
  },
  {
    code: 'reach_combo_6',
    name: 'Alcanza un combo de 6',
    description: 'Encadena una alineación de seis.',
    metric: 'max_combo',
    scope: 'creature',
    targetValue: 6,
    params: {},
  },
  {
    code: 'care_7_days',
    name: 'Cuida durante 7 días',
    description: 'Atiende a esta kriatura siete días.',
    metric: 'days_cared',
    scope: 'creature',
    targetValue: 7,
    params: {},
  },
];

async function seedGameAndConfig(db: Db): Promise<void> {
  const [game] = await db
    .insert(games)
    .values({ slug: GAME_SLUG, name: 'Kriaturas' })
    .onConflictDoUpdate({ target: games.slug, set: { name: 'Kriaturas' } })
    .returning();
  if (!game) throw new Error('Could not seed the game row');

  for (const key of CONFIG_KEYS) {
    const value = DEFAULT_CONFIG[key satisfies ConfigKey];
    await db
      .insert(gameConfigs)
      .values({ gameId: game.id, key, value })
      .onConflictDoUpdate({ target: [gameConfigs.gameId, gameConfigs.key], set: { value } });
  }
  console.log(`  game "${GAME_SLUG}" + ${CONFIG_KEYS.length} config rows`);
}

async function seedAdmin(db: Db): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({ email: ADMIN_EMAIL, displayName: 'Admin', role: 'admin' })
    .onConflictDoUpdate({ target: users.email, set: { role: 'admin' } })
    .returning();
  if (!user) throw new Error('Could not seed the admin user');

  const [player] = await db
    .insert(players)
    .values({ userId: user.id, food: 20, drakofruta: 8, coins: 500 })
    .onConflictDoUpdate({
      target: players.userId,
      set: { food: 20, drakofruta: 8, coins: 500 },
    })
    .returning();
  if (!player) throw new Error('Could not seed the admin player');

  console.log(`  admin ${ADMIN_EMAIL} (role=admin) + player pool 20 food / 8 fruta / 500 coins`);
  return player.id;
}

async function seedSpecies(db: Db, createdBy: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const seed of SPECIES_SEED) {
    /**
     * Two tables in one write (species + its evolution paths), so it runs in a
     * transaction: a species without its default path would be unevolvable.
     */
    await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(species)
        .values({
          slug: seed.slug,
          name: seed.name,
          baseElement: seed.baseElement,
          baseHp: seed.hp,
          baseAttack: seed.attack,
          baseDefense: seed.defense,
          manaCost: seed.manaCost,
          description: seed.description,
          isPublished: true,
          effects: parseEffectList(seed.effects),
          createdBy,
        })
        .onConflictDoUpdate({
          target: species.slug,
          set: {
            name: seed.name,
            baseHp: seed.hp,
            baseAttack: seed.attack,
            baseDefense: seed.defense,
            manaCost: seed.manaCost,
            description: seed.description,
            isPublished: true,
            effects: parseEffectList(seed.effects),
          },
        })
        .returning();
      if (!row) throw new Error(`Could not seed species ${seed.slug}`);
      ids.set(seed.slug, row.id);

      /** The canonical pair is only the DEFAULT path, not a limit. */
      const canonical = CANONICAL_EVOLUTIONS[seed.baseElement];
      await tx
        .insert(evolutionPaths)
        .values({
          speciesId: row.id,
          targetElement: canonical,
          name: `Vía ${canonical}`,
          isDefault: true,
          sortOrder: 0,
          hpBonus: 10,
          attackBonus: 5,
          defenseBonus: 3,
        })
        .onConflictDoNothing({ target: [evolutionPaths.speciesId, evolutionPaths.targetElement] });

      for (const [index, extra] of (seed.extraPaths ?? []).entries()) {
        await tx
          .insert(evolutionPaths)
          .values({
            speciesId: row.id,
            targetElement: extra.targetElement,
            name: extra.name,
            isDefault: false,
            sortOrder: index + 1,
            hpBonus: 16,
            attackBonus: extra.attackBonus,
            defenseBonus: 8,
          })
          .onConflictDoNothing({
            target: [evolutionPaths.speciesId, evolutionPaths.targetElement],
          });
      }
    });
  }

  console.log(`  ${SPECIES_SEED.length} species, each with its canonical path`);
  return ids;
}

async function seedObjectives(db: Db): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const seed of OBJECTIVE_SEED) {
    /** Validates that the params actually match the metric before writing. */
    const { params } = parseObjectiveParams(seed.metric, seed.params);

    const [row] = await db
      .insert(objectives)
      .values({
        code: seed.code,
        name: seed.name,
        description: seed.description,
        metric: seed.metric,
        scope: seed.scope,
        targetValue: seed.targetValue,
        params,
      })
      .onConflictDoUpdate({
        target: objectives.code,
        set: { name: seed.name, targetValue: seed.targetValue, params },
      })
      .returning();
    if (!row) throw new Error(`Could not seed objective ${seed.code}`);
    ids.set(seed.code, row.id);
  }

  console.log(`  ${OBJECTIVE_SEED.length} objectives`);
  return ids;
}

/**
 * Retoño is the branching example: poison is cheap to unlock, rock demands more.
 * This is what the admin panel will edit in the next checkpoint.
 */
async function seedRequirements(
  db: Db,
  speciesIds: Map<string, string>,
  objectiveIds: Map<string, string>,
): Promise<void> {
  const retonoId = speciesIds.get('retono');
  if (!retonoId) throw new Error('Missing seeded species: retono');

  const paths = await db.select().from(evolutionPaths).where(eq(evolutionPaths.speciesId, retonoId));
  const poison = paths.find((p) => p.targetElement === 'poison');
  const rock = paths.find((p) => p.targetElement === 'rock');
  if (!poison || !rock) throw new Error('Retoño is missing one of its evolution paths');

  const link = async (pathId: string, code: string): Promise<void> => {
    const objectiveId = objectiveIds.get(code);
    if (!objectiveId) throw new Error(`Missing seeded objective: ${code}`);
    await db
      .insert(evolutionRequirements)
      .values({ evolutionPathId: pathId, objectiveId })
      .onConflictDoNothing({
        target: [evolutionRequirements.evolutionPathId, evolutionRequirements.objectiveId],
      });
  };

  await link(poison.id, 'win_10_matches');
  await link(rock.id, 'clear_500_plant_gems');
  await link(rock.id, 'reach_combo_6');

  console.log('  requirements: poison needs 1 objective, rock needs 2');
}

async function seedEggs(db: Db, speciesIds: Map<string, string>): Promise<void> {
  const [eggType] = await db
    .insert(eggTypes)
    .values({
      slug: 'huevo-comun',
      name: 'Huevo común',
      description: 'Sale una kriatura al azar. Atiéndelo tres días para que eclosione.',
      priceAmount: 100,
      priceResource: 'coins',
      careDaysRequired: 3,
      maxMissedDays: 1,
      isPublished: true,
    })
    .onConflictDoUpdate({ target: eggTypes.slug, set: { isPublished: true } })
    .returning();
  if (!eggType) throw new Error('Could not seed the egg type');

  /** Rarer species carry a lower weight; the draw itself happens server-side. */
  const weights: Record<string, number> = { mentix: 1, onirio: 1, pirox: 2, marelo: 2 };

  for (const [slug, speciesId] of speciesIds) {
    await db
      .insert(eggTypeSpecies)
      .values({ eggTypeId: eggType.id, speciesId, weight: weights[slug] ?? 4 })
      .onConflictDoNothing({ target: [eggTypeSpecies.eggTypeId, eggTypeSpecies.speciesId] });
  }

  console.log(`  1 egg type with a weighted pool of ${speciesIds.size} species`);
}

/**
 * One starter creature so there is something with derivable stamina to look at.
 * It uses initialAnchor, NOT the column default: the default now() would hatch
 * it with zero stamina.
 */
async function seedStarterCreature(
  db: Db,
  playerId: string,
  speciesIds: Map<string, string>,
  now: Date,
): Promise<void> {
  const existing = await db.select().from(creatures).where(eq(creatures.playerId, playerId));
  const have = new Set(existing.map((row) => row.nickname));

  /**
   * Two starters of DIFFERENT elements, matching play.teamSize. A team of two
   * fire creatures would leave three quarters of the board useless.
   */
  const starters: { slug: string; nickname: string }[] = [
    { slug: 'retono', nickname: 'Retoñito' },
    { slug: 'brasilla', nickname: 'Chispa' },
  ];

  /** Tops up to the full starter set rather than skipping when one exists. */
  let added = 0;
  for (const starter of starters) {
    if (have.has(starter.nickname)) continue;
    const speciesId = speciesIds.get(starter.slug);
    if (!speciesId) throw new Error(`Missing seeded species: ${starter.slug}`);
    await db.insert(creatures).values({
      playerId,
      speciesId,
      nickname: starter.nickname,
      lastFed: initialAnchor(now, DEFAULT_CONFIG.stamina),
    });
    added += 1;
  }
  console.log(`  starter creatures: ${added} nuevas, ${existing.length + added} en total`);
}

async function main(): Promise<void> {
  const { db, kind, close } = await createConnection();
  const now = new Date();
  console.log(`Seeding via the ${kind} driver...`);

  try {
    await seedGameAndConfig(db);
    const playerId = await seedAdmin(db);
    const speciesIds = await seedSpecies(db, await adminUserId(db));
    const objectiveIds = await seedObjectives(db);
    await seedRequirements(db, speciesIds, objectiveIds);
    await seedEggs(db, speciesIds);
    await seedStarterCreature(db, playerId, speciesIds, now);
    console.log('Seed complete.');
  } finally {
    await close();
  }
}

async function adminUserId(db: Db): Promise<string> {
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ADMIN_EMAIL))
    .limit(1);
  if (!row) throw new Error('Admin user missing');
  return row.id;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
