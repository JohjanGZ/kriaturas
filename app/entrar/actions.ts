'use server';

import { redirect } from 'next/navigation';
import { createGuestPlayer, findSeededAdmin } from '@/db/queries/onboarding';
import { setSession } from '@/lib/auth';

/**
 * THE DOOR, until there is a real login.
 *
 * There is no authentication yet, and `lib/auth` disables its development
 * fallback in production on purpose — so on a deployed server nobody has a
 * user, and every page correctly reports that there is no player. This is what
 * gets somebody past that without pretending to be authentication: a button
 * that creates a guest account and hands out its cookie.
 *
 * What it deliberately is NOT:
 *
 * - it is not a login. There is no password, and the cookie IS the identity.
 *   Anyone who copies it is that guest. That is acceptable for a game nobody
 *   pays for yet, and it is why the account it creates can never be an admin.
 * - it does not run on page load. Setting a cookie needs an action, and making
 *   it a deliberate click means a crawler opening the link mints nothing.
 */
export type EntryState = { ok: boolean; message?: string };

export async function enterAsGuestAction(
  _prev: EntryState,
  _form: FormData,
): Promise<EntryState> {
  try {
    const guest = await createGuestPlayer(new Date());
    await setSession(guest.userId);
  } catch (error) {
    console.error(error);
    return { ok: false, message: 'No se pudo crear la partida de invitada.' };
  }

  /** Outside the try: `redirect` works by throwing, and a catch would eat it. */
  redirect('/jugar');
}

/**
 * The seeded admin's cookie, so the panel can be reached from a phone on a
 * deploy that has no login.
 *
 * Gated on an environment variable rather than on anything the browser sends:
 * a public link that hands out the admin panel to whoever clicks is not
 * something that should be reachable by guessing a URL, and a deploy that never
 * sets the variable simply does not have this door.
 */
export async function enterAsAdminAction(
  _prev: EntryState,
  _form: FormData,
): Promise<EntryState> {
  if (process.env.ALLOW_ADMIN_ENTRY !== 'true') {
    return { ok: false, message: 'Esta puerta está cerrada en este servidor.' };
  }

  const admin = await findSeededAdmin();
  if (!admin) return { ok: false, message: 'No hay cuenta de administración en esta base.' };

  await setSession(admin.userId);
  redirect('/admin/species');
}
