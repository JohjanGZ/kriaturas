import { eq } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getDb } from '@/db/client';
import { type PlayerRow, type UserRow, players, users } from '@/db/schema';

/**
 * ADMIN ACCESS — the role always comes from the DATABASE, server-side.
 *
 * Whatever identifies the visitor (a cookie today, real auth later) is only ever
 * used to look up a row. The role is then read from that row. A client-supplied
 * role, header or cookie flag is never consulted, so forging one buys nothing.
 *
 * ---------------------------------------------------------------------------
 * PLACEHOLDER IDENTITY. There is no login yet. Outside production this module
 * falls back to the seeded admin so the panel is usable during development. In
 * production the fallback is disabled: with no session cookie there is no user,
 * and the panel refuses everyone until real authentication is wired in here.
 * That is the ONLY thing this file is missing — the authorisation half is real.
 * ---------------------------------------------------------------------------
 */

const SESSION_COOKIE = 'kriaturas_uid';
const DEV_FALLBACK_EMAIL = process.env.DEV_ADMIN_EMAIL ?? 'admin@kriaturas.local';

export class AdminAccessError extends Error {
  constructor(message = 'Se requiere una cuenta de administrador') {
    super(message);
    this.name = 'AdminAccessError';
  }
}

/**
 * Writes the session cookie.
 *
 * Callable ONLY from a server action or a route handler — a page render cannot
 * set a cookie in the App Router, which is exactly why entering is a button and
 * not something that happens silently while a page loads. That turns out to be
 * the right shape anyway: a crawler that opens the link does not mint an
 * account, only somebody who chose to play does.
 *
 * `httpOnly` so no script can read it, `sameSite: lax` so it survives following
 * a shared link, and `secure` off localhost so it is never sent in the clear.
 */
export async function setSession(userId: string): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, userId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearSession(): Promise<void> {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

/**
 * Is the placeholder identity still in play?
 *
 * Local development falls back to the seeded admin, so there is nothing to
 * enter. A deployed server has no fallback, and this is what the pages ask
 * before sending somebody to the door rather than showing them an empty game.
 */
export function hasDevFallback(): boolean {
  return process.env.NODE_ENV !== 'production';
}

export async function getCurrentUser(): Promise<UserRow | null> {
  const db = await getDb();
  const jar = await cookies();
  const userId = jar.get(SESSION_COOKIE)?.value;

  if (userId) {
    const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    return row ?? null;
  }

  /** Development convenience only. Never reachable in production. */
  if (process.env.NODE_ENV === 'production') return null;

  const [row] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEV_FALLBACK_EMAIL))
    .limit(1);
  return row ?? null;
}

/**
 * The game profile of whoever is asking. Player-facing pages use this; like the
 * admin role, it is resolved from rows on the server, never from the client.
 */
export async function getCurrentPlayer(): Promise<PlayerRow | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const db = await getDb();
  const [row] = await db.select().from(players).where(eq(players.userId, user.id)).limit(1);
  return row ?? null;
}

export async function isAdmin(): Promise<boolean> {
  const user = await getCurrentUser();
  return user?.role === 'admin';
}

/**
 * Guards a PAGE. Call it as the first statement of every admin page, before any
 * query runs.
 *
 * A guard in the layout is NOT enough: in the App Router the layout and the page
 * render in parallel, so a page that only *looks* hidden has already executed its
 * queries and its output still ships inside the RSC payload. Redirecting from the
 * page is what actually stops both the query and the response.
 */
export async function requireAdminPage(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') redirect('/acceso-restringido');
  return user;
}

/**
 * Guards a mutation. Every server action calls this itself — the layout check is
 * for rendering, not for security: actions are addressable on their own and a
 * page guard does not protect them.
 */
export async function requireAdmin(): Promise<UserRow> {
  const user = await getCurrentUser();
  if (!user) throw new AdminAccessError('No hay sesión iniciada');
  if (user.role !== 'admin') throw new AdminAccessError();
  return user;
}
