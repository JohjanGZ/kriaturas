import { asc, eq } from 'drizzle-orm';
import { DEFAULT_CONFIG } from '@/core/schemas/config';
import { initialAnchor } from '@/core/stamina';
import { getDb } from '../client';
import { corrals, creatures, incubators, players, species, users } from '../schema';

/**
 * A NEW PLAYER FROM NOTHING — what a hosted deploy needs and a seeded laptop
 * does not.
 *
 * Locally there is one seeded account and `lib/auth` falls back to it. On a
 * server there is no fallback (it is disabled in production on purpose), so
 * somebody opening the link has no user, no player and no creatures: the game
 * renders "no hay jugador" and that is the whole experience.
 *
 * So a visitor gets their OWN player. Not a shared demo account: one battle at
 * a time is enforced per player by a unique index, so two people on one account
 * would fight over the same row — the second person's game would refuse to
 * start with no way to explain why.
 *
 * It grants no privilege. The role is `player`, always, hard-coded here rather
 * than passed in: this function is reachable by anyone who opens the site, and
 * an argument that could say `admin` would be an admin account anyone can mint.
 */
export type GuestSession = { userId: string; playerId: string };

export async function createGuestPlayer(now: Date): Promise<GuestSession> {
  const db = await getDb();

  return db.transaction(async (tx) => {
    /**
     * The email is an internal handle, not an address: nothing is ever sent to
     * it. It exists because `users.email` is the unique key a real login will
     * later fill in.
     */
    const handle = `invitada-${crypto.randomUUID()}@kriaturas.local`;

    const [user] = await tx
      .insert(users)
      .values({ email: handle, displayName: 'Invitada', role: 'player' })
      .returning();
    if (!user) throw new Error('No se pudo crear la cuenta de invitada');

    const [player] = await tx
      .insert(players)
      .values({
        userId: user.id,
        food: 20,
        coins: 500,
        /**
         * UNA PIEDRA GRATIS esperando. La primera kriatura que eclosione nace
         * bloqueada, y ese primer bloqueo trae su propia solución: se aprende
         * el bucle entero en un gesto y solo la SEGUNDA cuesta monedas.
         */
        freeStones: 1,
      })
      .returning();
    if (!player) throw new Error('No se pudo crear el jugador de invitada');

    /**
     * A STARTING STABLE, chosen from what is actually published rather than
     * from a list of slugs.
     *
     * The seed's starters name their species; this cannot, because the database
     * behind a deploy may have been edited in the admin since. So it takes one
     * species per base element — the board deals four, and a team of two is
     * only a choice when there is something to choose between.
     */
    /**
     * El corral donde viven y la incubadora: los dos se REGALAN, por el mismo
     * motivo — sin ellos se compra un huevo y no hay dónde ponerlo, ni dónde
     * viva lo que salga.
     */
    const [home] = await tx
      .insert(corrals)
      .values({ playerId: player.id, name: 'Corral', capacity: 10, paidAmount: 0 })
      .returning();

    await tx.insert(incubators).values({
      playerId: player.id,
      name: 'Incubadora básica',
      capacityDays: 1,
      paidAmount: 0,
    });

    const pool = await tx
      .select({ id: species.id, baseElement: species.baseElement, name: species.name })
      .from(species)
      .where(eq(species.isPublished, true))
      .orderBy(asc(species.name));


    const perElement = new Map<string, { id: string; name: string }>();
    for (const row of pool) {
      if (row.baseElement === null) continue;
      if (!perElement.has(row.baseElement)) {
        perElement.set(row.baseElement, { id: row.id, name: row.name });
      }
    }

    /**
     * TRES KRIATURAS, DE TRES ELEMENTOS DISTINTOS.
     *
     * Distintos no es un detalle: un equipo son dos de elementos diferentes, así
     * que si dos compartieran elemento el jugador se encontraría un rechazo que
     * no entiende en su primer minuto. Con tres distintos tiene elección real
     * (tres parejas posibles) y le FALTA el cuarto, que es exactamente el antojo
     * que hace querer el primer huevo.
     *
     * Y ninguna es la blanca: el Albo no puede jugar, y de tres kriaturas una
     * inservible mata un tercio del establo antes de empezar. Tiene que ser un
     * HALLAZGO del huevo, no un regalo.
     */
    const starters = [...perElement.values()].slice(0, 3);

    /**
     * Nacen con la evolución ABIERTA. La transformación es lo mejor que tiene
     * el combate: esconderla detrás de un paso de tutorial es guardarse la
     * mejor carta. La lección de las piedras llega en la primera eclosión, con
     * el jugador ya queriendo lo que vio.
     */
    const anchor = initialAnchor(now, DEFAULT_CONFIG.stamina);
    if (starters.length > 0) {
      await tx.insert(creatures).values(
        starters.map((starter, index) => ({
          playerId: player.id,
          speciesId: starter.id,
          nickname: starter.name,
          isExcellent: index < 1,
          corralId: home?.id ?? null,
          evolutionUnlockedAt: now,
          lastFed: anchor,
        })),
      );
    }

    return { userId: user.id, playerId: player.id };
  });
}

/**
 * The seeded ADMIN account, when the database has one.
 *
 * The entry page offers it as a second door so a phone can reach the admin
 * panel on a deploy that has no login yet. It is offered only when
 * `ALLOW_ADMIN_ENTRY` is set, because handing the panel to whoever opens the
 * link is not a default anybody should get by accident.
 */
export async function findSeededAdmin(): Promise<GuestSession | null> {
  const db = await getDb();
  const [row] = await db
    .select({ userId: users.id, playerId: players.id })
    .from(users)
    .innerJoin(players, eq(players.userId, users.id))
    .where(eq(users.role, 'admin'))
    .limit(1);
  return row ?? null;
}
