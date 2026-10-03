import { redirect } from 'next/navigation';
import { getCorralShelf, giveStarterCorral } from '@/db/queries/corral';
import { getCurrentPlayer, hasDevFallback } from '@/lib/auth';
import { Pen } from './pen';

/**
 * El corral. Todo lo de esta pantalla se deriva en el servidor para este
 * render — la stamina de cada kriatura sale de su ancla de regeneración, no de
 * ninguna columna — así que la página no tiene estado propio con el que
 * equivocarse.
 */
export default async function CorralPage() {
  const player = await getCurrentPlayer();
  if (!player) {
    if (!hasDevFallback()) redirect('/entrar');
    return (
      <main className="shell">
        <h1>Corral</h1>
        <div className="card">
          <p>No hay jugador todavía.</p>
          <p className="small muted">
            Ejecuta <code>npm run db:seed</code>.
          </p>
        </div>
      </main>
    );
  }

  /**
   * Adopta a las sueltas al entrar: las kriaturas que nacieron antes de que
   * existieran los corrales no deberían quedarse a la intemperie solo porque
   * nadie corrió una migración de datos.
   */
  await giveStarterCorral(player.id);

  const shelf = await getCorralShelf(player.id, new Date());
  if (!shelf) redirect('/jugar');

  /**
   * Sin `shell` y sin `<h1>`: la columna de 1100 px y el título costaban ancho
   * y alto justo en la pantalla cuyo contenido ES el sitio. El nombre del
   * corral ya va flotando sobre el cercado, igual que el del campo sobre el
   * tablero.
   */
  return (
    <main className="corral-page">
      <Pen shelf={shelf} />
    </main>
  );
}
