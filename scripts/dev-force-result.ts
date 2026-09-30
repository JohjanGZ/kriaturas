import 'dotenv/config';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { FIELD_KINDS, type FieldKind, armField } from '@/core/fields';
import { BASE_ELEMENTS, type BaseElement } from '@/core/elements';
import { battleFieldSchema } from '@/core/schemas/battle';
import { awakenCreature } from '@/db/queries/creature';
import { parseConfig } from '@/core/schemas/config';
import { createConnection } from '@/db/client';
import {
  battles,
  creatures,
  gameConfigs,
  games,
  seasonAdjustments,
  seasons,
  species,
} from '@/db/schema';

/**
 * Gets a battle to its ENDING quickly, so the win/loss screen can be looked at
 * without grinding a fight out.
 *
 * A development tool, like the terminal simulator: it writes nothing the game
 * itself could not write, and it only ever touches the local database. Run it
 * with the dev server STOPPED — the local database is a single-process file.
 *
 *   npx tsx scripts/dev-force-result.ts            # end the active battle as won
 *   npx tsx scripts/dev-force-result.ts lost
 *   npx tsx scripts/dev-force-result.ts hp 12      # tune playerMaxHp for a short fight
 *   npx tsx scripts/dev-force-result.ts shield 30  # give the BOT a shield, to watch a pierce
 *   npx tsx scripts/dev-force-result.ts campo minado   # put the active battle on a field
 *   npx tsx scripts/dev-force-result.ts piedra albo water  # the stone the game has not got yet
 *
 * `npm run db:seed` puts the config back to its defaults.
 */
const mode = process.argv[2] ?? 'won';
const wanted: 'won' | 'lost' = mode === 'lost' ? 'lost' : 'won';

/** Rewrites combat.playerMaxHp, so the next battle ends in a couple of specials. */
async function setPlayerMaxHp(
  db: Awaited<ReturnType<typeof createConnection>>['db'],
  hp: number,
): Promise<void> {
  const [game] = await db.select().from(games).where(eq(games.slug, 'kriaturas')).limit(1);
  if (!game) throw new Error('No hay juego sembrado.');

  const [row] = await db
    .select()
    .from(gameConfigs)
    .where(and(eq(gameConfigs.gameId, game.id), eq(gameConfigs.key, 'combat')))
    .limit(1);
  if (!row) throw new Error('No hay fila de configuración de combate.');

  /** Parsed and re-parsed, so this tool cannot write a shape the game rejects. */
  const combat = parseConfig('combat', row.value);
  const value = parseConfig('combat', { ...combat, playerMaxHp: hp });

  await db
    .update(gameConfigs)
    .set({ value })
    .where(and(eq(gameConfigs.gameId, game.id), eq(gameConfigs.key, 'combat')));
  console.log(`combat.playerMaxHp = ${hp}`);
}

/**
 * Makes the board rain drakofruta and the transformation cheap, so the
 * in-battle evolution can be exercised without waiting on the dice.
 */
async function tuneFruit(
  db: Awaited<ReturnType<typeof createConnection>>['db'],
  weight: number,
  threshold: number,
): Promise<void> {
  const [game] = await db.select().from(games).where(eq(games.slug, 'kriaturas')).limit(1);
  if (!game) throw new Error('No hay juego sembrado.');

  const [row] = await db
    .select()
    .from(gameConfigs)
    .where(and(eq(gameConfigs.gameId, game.id), eq(gameConfigs.key, 'combat')))
    .limit(1);
  if (!row) throw new Error('No hay fila de configuración de combate.');

  const combat = parseConfig('combat', row.value);
  const value = parseConfig('combat', {
    ...combat,
    fruitsToEvolve: threshold,
    tileWeights: { ...combat.tileWeights, drakofruta: weight },
  });

  await db
    .update(gameConfigs)
    .set({ value })
    .where(and(eq(gameConfigs.gameId, game.id), eq(gameConfigs.key, 'combat')));
  console.log(`drakofruta: peso ${weight}, transformación a las ${threshold}`);
}

/**
 * Applies a season adjustment from the console, so the balance layer can be
 * exercised without clicking through the admin panel.
 */
async function nerf(
  db: Awaited<ReturnType<typeof createConnection>>['db'],
  slug: string,
  attackDelta: number,
  manaCostDelta: number,
): Promise<void> {
  const [target] = await db.select().from(species).where(eq(species.slug, slug)).limit(1);
  if (!target) throw new Error(`No existe la especie ${slug}`);

  const [season] = await db.select().from(seasons).where(eq(seasons.isActive, true)).limit(1);
  if (!season) throw new Error('No hay temporada en curso.');

  await db
    .insert(seasonAdjustments)
    .values({
      seasonId: season.id,
      speciesId: target.id,
      attackDelta,
      manaCostDelta,
      note: 'ajuste de prueba',
    })
    .onConflictDoUpdate({
      target: [seasonAdjustments.seasonId, seasonAdjustments.speciesId],
      set: { attackDelta, manaCostDelta },
    });

  console.log(`${target.name}: ${attackDelta} de ataque, ${manaCostDelta} de maná`);
}

/**
 * Arms the rival with a shield. `damage` is the piercing channel, so this is
 * how the difference is LOOKED at: a blockable special dies on this wall and a
 * piercing one walks through it, with the 🛡 pill on the rival's side of the HUD
 * proving the wall was really there.
 */
async function shieldTheBot(
  db: Awaited<ReturnType<typeof createConnection>>['db'],
  amount: number,
): Promise<void> {
  const [battle] = await db
    .select()
    .from(battles)
    .where(eq(battles.status, 'active'))
    .orderBy(desc(battles.startedAt))
    .limit(1);
  if (!battle) throw new Error('No hay ninguna partida activa.');

  await db
    .update(battles)
    .set({ opponentShield: amount, opponentShieldTurns: 99 })
    .where(eq(battles.id, battle.id));
  console.log(`El rival lleva un escudo de ${amount} en la partida ${battle.id}.`);
}

/**
 * Drops the active battle onto a chosen field, mines included.
 *
 * A field is ROLLED at the start and cannot be picked — which is right for the
 * game and useless for looking at one in particular, hence this. The mines are
 * laid on the board that is actually there, so their cells are real.
 */
async function setField(
  db: Awaited<ReturnType<typeof createConnection>>['db'],
  wanted: string,
): Promise<void> {
  if (!(FIELD_KINDS as readonly string[]).includes(wanted)) {
    throw new Error(`Campo desconocido. Hay: ${FIELD_KINDS.join(', ')}`);
  }
  const kind = wanted as FieldKind;

  const [battle] = await db
    .select()
    .from(battles)
    .where(eq(battles.status, 'active'))
    .orderBy(desc(battles.startedAt))
    .limit(1);
  if (!battle) throw new Error('No hay ninguna partida activa.');

  const board = battle.board as { width: number; height: number };
  const rolled = armField(
    { width: board.width, height: board.height, tiles: [] },
    { kind, element: kind === 'volcan' ? 'fire' : null, bombs: [] },
    Math.random,
  );

  await db
    .update(battles)
    .set({ field: battleFieldSchema.parse(rolled) })
    .where(eq(battles.id, battle.id));
  console.log(`La partida ${battle.id} se juega ahora en: ${kind}.`);
}

/**
 * Uses the elemental stone that DOES NOT EXIST YET.
 *
 * The item and the way a player gets one are still to be built; the write it
 * will perform is already here (`awakenCreature`), so the white creature can be
 * looked at awake without waiting for the economy around it.
 */
async function useStone(
  db: Awaited<ReturnType<typeof createConnection>>['db'],
  slug: string,
  element: string,
): Promise<void> {
  if (!(BASE_ELEMENTS as readonly string[]).includes(element)) {
    throw new Error(`Elemento no válido. Hay: ${BASE_ELEMENTS.join(', ')}`);
  }

  const [target] = await db
    .select({ id: creatures.id, playerId: creatures.playerId })
    .from(creatures)
    .innerJoin(species, eq(species.id, creatures.speciesId))
    .where(and(eq(species.slug, slug), isNull(creatures.element)))
    .limit(1);
  if (!target) throw new Error(`No hay ninguna kriatura blanca de "${slug}" sin despertar.`);

  const result = await awakenCreature(
    target.id,
    target.playerId,
    element as BaseElement,
    new Date(),
  );
  console.log(
    result.ok
      ? `La kriatura ${target.id} despertó como ${element}.`
      : `No se pudo: ${result.reason}`,
  );
}

async function main(): Promise<void> {
  const { db, close } = await createConnection();

  try {
    if (mode === 'nerf') {
      await nerf(db, String(process.argv[3] ?? ''), Number(process.argv[4] ?? 0), Number(process.argv[5] ?? 0));
      return;
    }
    if (mode === 'piedra') {
      await useStone(db, String(process.argv[3] ?? ''), String(process.argv[4] ?? ''));
      return;
    }
    if (mode === 'campo') {
      await setField(db, String(process.argv[3] ?? ''));
      return;
    }
    if (mode === 'shield') {
      await shieldTheBot(db, Number(process.argv[3] ?? 30));
      return;
    }
    if (mode === 'fruit') {
      await tuneFruit(db, Number(process.argv[3] ?? 8), Number(process.argv[4] ?? 3));
      return;
    }
    if (mode === 'hp') {
      const hp = Number(process.argv[3] ?? 12);
      if (!Number.isInteger(hp) || hp < 1) throw new Error('Vida no válida.');
      await setPlayerMaxHp(db, hp);
      return;
    }

    /**
     * Every unread result at once. Testing piles them up — each one waits its
     * turn on the play screen, which is the feature working — and nobody wants
     * to click through a dozen of them before playing again.
     */
    if (mode === 'clear') {
      const unread = and(
        inArray(battles.status, ['won', 'lost']),
        isNull(battles.dismissedAt),
      );
      const pending = await db.select({ id: battles.id }).from(battles).where(unread);
      await db.update(battles).set({ dismissedAt: new Date() }).where(unread);
      console.log(`Resultados pendientes marcados como vistos: ${pending.length}`);
      return;
    }

    const [battle] = await db
      .select()
      .from(battles)
      .where(eq(battles.status, 'active'))
      .orderBy(desc(battles.startedAt))
      .limit(1);

    if (!battle) {
      console.log('No hay ninguna partida activa que terminar.');
      return;
    }

    /**
     * `dismissed_at` stays null on purpose: that null is what keeps the result
     * on screen until the player closes it.
     */
    await db
      .update(battles)
      .set({
        status: wanted,
        endedAt: new Date(),
        dismissedAt: null,
        opponentHp: wanted === 'won' ? 0 : battle.opponentHp,
        playerHp: wanted === 'lost' ? 0 : battle.playerHp,
      })
      .where(eq(battles.id, battle.id));

    console.log(`Partida ${battle.id} marcada como ${wanted}.`);
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
