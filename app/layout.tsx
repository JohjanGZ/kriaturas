import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { isAdmin } from '@/lib/auth';
import './globals.css';

export const metadata = {
  title: 'Kriaturas',
  description: 'Match-3 de colección de kriaturas',
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  /**
   * The admin links are DRAWN for admins only — and this is decoration, not
   * security: every admin page guards itself and every action re-reads the role
   * from the database. What it fixes is that a guest used to see "Panel admin"
   * and get bounced to a refusal page for tapping it.
   */
  const admin = await isAdmin();
  const door = process.env.ALLOW_ADMIN_ENTRY === 'true';

  return (
    <html lang="es">
      <body>
        <header className="topbar">
          <Link href="/" className="brand" aria-label="Kriaturas — inicio">
            <Image
              src="/brand/logo-mark.png"
              alt=""
              width={512}
              height={512}
              className="brand-mark"
              priority
            />
            <Image
              src="/brand/logo-full.png"
              alt="Kriaturas"
              width={900}
              height={450}
              className="brand-full"
              priority
            />
          </Link>
          <nav>
            <Link href="/jugar">Jugar</Link>
            <Link href="/corral">Corral</Link>
            <Link href="/kriaturas">Mis kriaturas</Link>
            <Link href="/huevos">Incubadora</Link>

            {admin ? (
              <>
                <Link href="/admin/species">Especies</Link>
                <Link href="/admin/campos">Campos</Link>
                <Link href="/admin/temporadas">Temporadas</Link>
              </>
            ) : door ? (
              /*
               * One tap into the panel, with no password anywhere.
               *
               * `prefetch={false}` matters: this URL GRANTS the session, and a
               * link Next fetched on its own would hand it out to anybody who
               * merely scrolled past it.
               */
              <Link href="/admin/acceso" prefetch={false} className="nav-admin">
                Entrar como admin
              </Link>
            ) : null}
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
