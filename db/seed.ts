import 'dotenv/config';
import { eq } from 'drizzle-orm';
import {
  BASE_ELEMENTS,
  type BaseElement,
  type Element,
  superiorElementFor,
} from '@/core/elements';
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
  seasons,
  species,
  speciesForms,
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
  /** Null means it is born WHITE: a stone decides what each creature becomes. */
  baseElement: BaseElement | null;
  hp: number;
  attack: number;
  defense: number;
  description: string;
  manaCost: number;
  effects: unknown[];
};

const SPECIES_SEED: SpeciesSeed[] = [
  /**
   * THE ONE WITH NO ELEMENT.
   *
   * It hatches white, it cannot be taken into a battle at all — no gem on the
   * board would charge it — and a stone turns it into one of four. That is why
   * its power is `shuffle_board`: a creature that has not decided what it is,
   * remaking the board so nobody else's plan survives either.
   */
  {
    slug: 'albo',
    manaCost: 10,
    name: 'Albo',
    baseElement: null,
    hp: 32,
    attack: 11,
    defense: 6,
    description:
      'Nace en blanco, sin elemento. No puede luchar hasta que una piedra elemental decida qué es — y entonces toma una de sus cuatro caras.',
    effects: [{ type: 'shuffle_board', target: 'enemy', condition: { turn_at_least: 3 } }],
  },
  {
    slug: 'brasilla',
    manaCost: 8,
    name: 'Brasilla',
    baseElement: 'fire',
    hp: 30,
    attack: 12,
    defense: 5,
    description: 'Cría de brasa. Pega de frente y sin adornos.',
    effects: [{ type: 'damage', target: 'enemy', value: 20 }],
  },
  {
    slug: 'pirox',
    manaCost: 11,
    name: 'Pirox',
    baseElement: 'fire',
    hp: 34,
    attack: 14,
    defense: 6,
    description: 'Guardián de ceniza. Convierte fichas del tablero en fuego.',
    effects: [{ type: 'convert_tiles', target: 'self', value: 4 }],
  },
  {
    slug: 'gotina',
    manaCost: 6,
    name: 'Gotina',
    baseElement: 'water',
    hp: 32,
    attack: 9,
    defense: 8,
    description: 'Gota viajera. Te devuelve vida cuando dispara.',
    effects: [{ type: 'heal', target: 'self', value: 14 }],
  },
  {
    slug: 'marelo',
    manaCost: 10,
    name: 'Marelo',
    baseElement: 'water',
    hp: 38,
    attack: 8,
    defense: 12,
    description: 'Caparazón de marea. Levanta un escudo que aguanta turnos.',
    effects: [{ type: 'shield', target: 'self', value: 16, duration_turns: 2 }],
  },
  {
    slug: 'retono',
    manaCost: 9,
    name: 'Retoño',
    baseElement: 'plant',
    hp: 35,
    attack: 10,
    defense: 9,
    description: 'Brote terco. Le quita maná a una rival y se lo queda.',
    effects: [{ type: 'drain_mana', target: 'enemy', value: 4, targets: 1, to_self: true }],
  },
  {
    slug: 'cactel',
    manaCost: 8,
    name: 'Cactel',
    baseElement: 'plant',
    hp: 33,
    attack: 11,
    defense: 10,
    description: 'Espinas pacientes. Bloquea el ataque de una kriatura rival.',
    effects: [{ type: 'block_attack', target: 'enemy', targets: 1, duration_turns: 1 }],
  },
  {
    slug: 'mentix',
    manaCost: 12,
    name: 'Mentix',
    baseElement: 'psychic',
    hp: 28,
    attack: 15,
    defense: 4,
    description: 'Mirada fija. Premia las alineaciones largas.',
    effects: [{ type: 'combo_bonus', target: 'self', value: 60, condition: { min_combo: 4 } }],
  },
  {
    slug: 'onirio',
    manaCost: 9,
    name: 'Onirio',
    baseElement: 'psychic',
    hp: 31,
    attack: 13,
    defense: 6,
    description: 'Tejedor de sueños. Devastador contra el agua.',
    effects: [{ type: 'damage_by_type', target: 'enemy', value: 26, condition: { enemy_element: 'water' } }],
  },

  /**
   * A wider roster, four per element.
   *
   * A team is two creatures on a board of four elements, so the choice only
   * means something when there are several ways to cover it: a cheap bar that
   * fires often, an expensive one that lands hard, and something in between.
   * The mana cost is the dial that separates them.
   */
  {
    slug: 'ascua',
    manaCost: 5,
    name: 'Ascua',
    baseElement: 'fire',
    hp: 26,
    attack: 7,
    defense: 4,
    description: 'Chispa terca. Su especial te regala otra jugada.',
    effects: [{ type: 'extra_move', target: 'self', value: 1 }],
  },
  {
    slug: 'volcanor',
    manaCost: 14,
    name: 'Volcanor',
    baseElement: 'fire',
    hp: 42,
    attack: 18,
    defense: 9,
    description: 'Coloso de lava. Deja al rival ardiendo: pierde vida por cada jugada.',
    effects: [{ type: 'poison', target: 'enemy', value: 3, duration_turns: 3 }],
  },
  {
    slug: 'rociada',
    manaCost: 5,
    name: 'Rociada',
    baseElement: 'water',
    hp: 29,
    attack: 7,
    defense: 7,
    description: 'Llovizna menuda. Carga las barras de tu pareja.',
    effects: [{ type: 'mana_boost', target: 'self', value: 4, targets: 2 }],
  },
  {
    slug: 'abisal',
    manaCost: 13,
    name: 'Abisal',
    baseElement: 'water',
    hp: 44,
    attack: 12,
    defense: 15,
    description: 'Sombra del fondo. Roba el maná de las DOS kriaturas rivales.',
    effects: [{ type: 'drain_mana', target: 'enemy', value: 5, targets: 2 }],
  },
  {
    slug: 'musgorro',
    manaCost: 6,
    name: 'Musgorro',
    baseElement: 'plant',
    hp: 30,
    attack: 9,
    defense: 8,
    description: 'Musgo glotón. Absorbe drakofruta de la barra del rival.',
    effects: [{ type: 'absorb_fruit', target: 'enemy', value: 2 }],
  },
  {
    slug: 'zarzal',
    manaCost: 13,
    name: 'Zarzal',
    baseElement: 'plant',
    hp: 40,
    attack: 16,
    defense: 11,
    description: 'Zarza que atrapa. Paraliza a una rival: su barra deja de cargar.',
    effects: [{ type: 'paralyze', target: 'enemy', targets: 1, duration_turns: 2 }],
  },
  {
    slug: 'duendel',
    manaCost: 6,
    name: 'Duendel',
    baseElement: 'psychic',
    hp: 25,
    attack: 8,
    defense: 5,
    description: 'Duende burlón. Le roba una jugada al rival.',
    effects: [{ type: 'steal_move', target: 'enemy', value: 1 }],
  },
  {
    slug: 'vigilio',
    manaCost: 14,
    name: 'Vigilio',
    baseElement: 'psychic',
    hp: 36,
    attack: 20,
    defense: 7,
    description: 'Ojo que no duerme. Golpea fuerte y se cura al hacerlo.',
    effects: [{ type: 'damage', target: 'enemy', value: 30 }, { type: 'heal', target: 'self', value: 10 }],
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
    .values({ userId: user.id, food: 20, coins: 500 })
    .onConflictDoUpdate({
      target: players.userId,
      set: { food: 20, coins: 500 },
    })
    .returning();
  if (!player) throw new Error('Could not seed the admin player');

  console.log(`  admin ${ADMIN_EMAIL} (role=admin) + player pool 20 food / 500 coins`);
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

      /**
       * TWO GRADES PER SPECIES, and the grade is read from the target element:
       *
       *   NORMAL   -> its own element. What any creature becomes: same colours,
       *               better numbers.
       *   SUPERIOR -> the canonical pair (fire -> light), +3 on every bonus, and
       *               ONLY an excellent creature may take it.
       *
       * The default flag points at the normal one, because that is what an
       * ordinary creature transforms into.
       */
      /**
       * A WHITE SPECIES HAS FOUR FUTURES, so it gets four faces and a pair of
       * paths per element instead of one pair. Which pair a creature uses is
       * decided by the element its stone gave it, so none of them is special
       * and the default is only there to satisfy the one-default index.
       */
      if (seed.baseElement === null) {
        for (const element of BASE_ELEMENTS) {
          await tx
            .insert(speciesForms)
            .values({ speciesId: row.id, element, name: `${seed.name} ${element}` })
            .onConflictDoUpdate({
              target: [speciesForms.speciesId, speciesForms.element],
              set: { name: `${seed.name} ${element}` },
            });
        }

        await tx
          .update(evolutionPaths)
          .set({ isDefault: false })
          .where(eq(evolutionPaths.speciesId, row.id));

        for (const [index, element] of BASE_ELEMENTS.entries()) {
          const pairs = [
            {
              targetElement: element as Element,
              name: `${seed.name} ${element} mayor`,
              hpBonus: 10,
              attackBonus: 5,
              defenseBonus: 3,
              isDefault: index === 0,
              sortOrder: index * 2,
            },
            {
              targetElement: superiorElementFor(element) as Element,
              name: `${seed.name} ${superiorElementFor(element)}`,
              hpBonus: 13,
              attackBonus: 8,
              defenseBonus: 6,
              isDefault: false,
              sortOrder: index * 2 + 1,
            },
          ];
          for (const grade of pairs) {
            await tx
              .insert(evolutionPaths)
              .values({ speciesId: row.id, ...grade, effects: parseEffectList([]) })
              .onConflictDoUpdate({
                target: [evolutionPaths.speciesId, evolutionPaths.targetElement],
                set: {
                  name: grade.name,
                  hpBonus: grade.hpBonus,
                  attackBonus: grade.attackBonus,
                  defenseBonus: grade.defenseBonus,
                  isDefault: grade.isDefault,
                  sortOrder: grade.sortOrder,
                },
              });
          }
        }
        return;
      }

      const superior = superiorElementFor(seed.baseElement);
      /**
       * A PATH STRENGTHENS THE SAME POWER, it does not hand out a new one.
       *
       * Path effects are ADDED to the species ones, so a second copy of the same
       * primitive is literally "more of what this creature does" — the numbers
       * add, the durations and target counts take the larger. A creature that
       * transformed should feel like itself, louder.
       */
      const louder = (factor: number): unknown[] =>
        parseEffectList(seed.effects).map((effect) => {
          const scaled = { ...effect } as Record<string, unknown>;
          if (typeof scaled.value === 'number') {
            scaled.value = Math.max(1, Math.round(scaled.value * factor));
          }
          return scaled;
        });

      const grades = [
        {
          targetElement: seed.baseElement as Element,
          name: `${seed.name} mayor`,
          hpBonus: 10,
          attackBonus: 5,
          defenseBonus: 3,
          isDefault: true,
          sortOrder: 0,
          effects: parseEffectList(louder(0.5)),
        },
        {
          targetElement: superior as Element,
          name: `${seed.name} ${superior}`,
          hpBonus: 13,
          attackBonus: 8,
          defenseBonus: 6,
          isDefault: false,
          sortOrder: 1,
          effects: parseEffectList(louder(1)),
        },
      ];

      /** One default per species is a unique index: clear it before writing. */
      await tx
        .update(evolutionPaths)
        .set({ isDefault: false })
        .where(eq(evolutionPaths.speciesId, row.id));

      for (const grade of grades) {
        await tx
          .insert(evolutionPaths)
          .values({ speciesId: row.id, ...grade })
          .onConflictDoUpdate({
            target: [evolutionPaths.speciesId, evolutionPaths.targetElement],
            set: {
              name: grade.name,
              hpBonus: grade.hpBonus,
              attackBonus: grade.attackBonus,
              defenseBonus: grade.defenseBonus,
              isDefault: grade.isDefault,
              sortOrder: grade.sortOrder,
              effects: grade.effects,
            },
          });
      }
    });
  }

  console.log(`  ${SPECIES_SEED.length} species, each with a normal and a superior path`);
  return ids;
}

/**
 * One running season, with no adjustments.
 *
 * It exists so the balance layer is REAL from the first boot: nerfing a creature
 * must never require creating infrastructure first, or nobody does it on the
 * night a creature turns out to be broken.
 */
async function seedSeason(db: Db): Promise<void> {
  const [existing] = await db.select().from(seasons).limit(1);
  if (existing) {
    console.log('  season: ya existe, no la toco');
    return;
  }
  await db.insert(seasons).values({ name: 'Temporada 1', isActive: true });
  console.log('  season: Temporada 1 en curso, sin ajustes');
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
 * Objectives are TRACKED but gate nothing right now.
 *
 * They used to gate the permanent evolution, which no longer exists: evolving
 * happens inside a battle, paid for with the drakofruta on the board. The
 * catalog and the progress counters stay because they are the raw material for
 * whatever unlock comes next — but nothing is linked to a path, so nothing here
 * can fail on a species whose branches changed.
 */

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
  /**
   * `albo` is the rarest thing in the pool: about one hatch in sixty. It is the
   * white one, and finding it has to feel like finding something — a common
   * blank creature would just be an inconvenience with an extra step.
   */
  const weights: Record<string, number> = { albo: 1, mentix: 1, onirio: 1, pirox: 2, marelo: 2 };

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
   * A starting stable, not a fixed pair.
   *
   * The team is two creatures (`play.teamSize`) on a board of four elements, so
   * picking them is only a decision when there is something to pick FROM: every
   * element is covered here, with a cheap bar and an expensive one among them.
   */
  const starters: { slug: string; nickname: string; excellent?: boolean }[] = [
    { slug: 'retono', nickname: 'Retoñito' },
    /** Two EXCELLENT starters, so the rare form can be seen without farming. */
    { slug: 'brasilla', nickname: 'Chispa', excellent: true },
    { slug: 'gotina', nickname: 'Gotita', excellent: true },
    { slug: 'onirio', nickname: 'Sueñito' },
    { slug: 'ascua', nickname: 'Ascuita' },
    { slug: 'rociada', nickname: 'Llovizna' },
    { slug: 'musgorro', nickname: 'Musguito' },
    { slug: 'duendel', nickname: 'Duendecillo' },
    /** The white one, so the mechanic is visible from the first roster. */
    { slug: 'albo', nickname: 'Blanquito' },
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
      isExcellent: starter.excellent ?? false,
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
    await seedSeason(db);
    await seedObjectives(db);
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
