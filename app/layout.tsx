import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import './globals.css';

export const metadata = {
  title: 'Kriaturas',
  description: 'Match-3 de colección de kriaturas',
};

export default function RootLayout({ children }: { children: ReactNode }) {
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
            <Link href="/kriaturas">Mis kriaturas</Link>
            <Link href="/admin/species">Panel admin</Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
