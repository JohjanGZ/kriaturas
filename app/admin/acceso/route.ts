import { NextResponse } from 'next/server';
import { findSeededAdmin } from '@/db/queries/onboarding';
import { setSession } from '@/lib/auth';

/**
 * THE ADMIN DOOR AS A LINK.
 *
 * A page cannot write a cookie in the App Router, which is why entering was a
 * button on `/entrar`. A route handler can — so this is the same door with a
 * URL, reachable from the nav in one tap instead of two and a typed address.
 *
 * It is NOT a login and never becomes one. What guards it is
 * `ALLOW_ADMIN_ENTRY`, an environment variable on the server: with it off this
 * route refuses everyone, and with it on anybody who opens the link is an
 * admin. That is the whole trade, it is deliberate, and it is why the variable
 * should be off whenever the public link is being shared.
 *
 * `force-dynamic` because it reads cookies and a cached answer would be a
 * session handed to the wrong person.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const home = new URL('/acceso-restringido', request.url);
  if (process.env.ALLOW_ADMIN_ENTRY !== 'true') return NextResponse.redirect(home);

  const admin = await findSeededAdmin();
  if (!admin) return NextResponse.redirect(home);

  await setSession(admin.userId);
  return NextResponse.redirect(new URL('/admin/species', request.url));
}
