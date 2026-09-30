import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getEggShelf } from '@/db/queries/egg';
import { getCurrentPlayer, hasDevFallback } from '@/lib/auth';
import { Shelf } from './shelf';

/**
 * The incubator screen.
 *
 * Everything on it is derived on the server for this render — days lived, days
 * already paid, what the next recharge costs — so the page has no state of its
 * own to be wrong about. What an egg CONTAINS is not on it at all: that was
 * rolled at purchase and no query returns it until it hatches.
 */
export default async function EggsPage() {
  const player = await getCurrentPlayer();
  if (!player) {
    if (!hasDevFallback()) redirect('/entrar');
    return (
      <main className="shell">
        <h1>Incubadora</h1>
        <div className="card">
          <p>No hay jugador todavía.</p>
          <p className="small muted">
            Ejecuta <code>npm run db:seed</code>.
          </p>
        </div>
      </main>
    );
  }

  const shelf = await getEggShelf(player.id, new Date());
  if (!shelf) redirect('/jugar');

  return (
    <main className="shell">
      <p className="small">
        <Link href="/kriaturas">← Mis kriaturas</Link>
      </p>
      <h1>Incubadora</h1>
      <Shelf shelf={shelf} />
    </main>
  );
}
