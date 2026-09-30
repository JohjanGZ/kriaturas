import { redirect } from 'next/navigation';
import { getCurrentPlayer } from '@/lib/auth';
import { EntryForm } from './entry-form';

/**
 * The door for a DEPLOYED server, where there is no login and no fallback.
 *
 * Locally this page is never needed — `lib/auth` falls back to the seeded
 * account — so anyone who already has a player is sent straight to the game
 * rather than shown a button that would mint a second one.
 */
export default async function EntryPage() {
  const player = await getCurrentPlayer();
  if (player) redirect('/jugar');

  return (
    <main className="shell">
      <h1>Kriaturas</h1>

      <div className="card">
        <p>
          Todavía no hay cuentas: esto crea una partida de <strong>invitada</strong> con sus
          propias kriaturas, guardada en este dispositivo.
        </p>
        <p className="small muted">
          No hay contraseña ni correo. Si borras las cookies del navegador pierdes el acceso a
          esa partida, y abrirla en otro teléfono empieza una distinta.
        </p>

        <EntryForm adminDoor={process.env.ALLOW_ADMIN_ENTRY === 'true'} />
      </div>
    </main>
  );
}
