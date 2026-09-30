import Link from 'next/link';
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
  const adminDoor = process.env.ALLOW_ADMIN_ENTRY === 'true';

  /**
   * Somebody who already has a game is sent to it — unless the admin door is
   * open, because then this page is also the only way to REACH the panel. A
   * redirect there would mean the door exists and nobody can ever open it
   * without first clearing their cookies, which is not a door.
   */
  if (player && !adminDoor) redirect('/jugar');

  return (
    <main className="shell">
      <h1>Kriaturas</h1>

      <div className="card">
        {player ? (
          <p>
            Ya tienes una partida en este dispositivo. <Link href="/jugar">Seguir jugando</Link>,
            o entra al panel — eso cambia de cuenta y deja la partida de invitada atrás.
          </p>
        ) : (
          <>
            <p>
              Todavía no hay cuentas: esto crea una partida de <strong>invitada</strong> con sus
              propias kriaturas, guardada en este dispositivo.
            </p>
            <p className="small muted">
              No hay contraseña ni correo. Si borras las cookies del navegador pierdes el acceso
              a esa partida, y abrirla en otro teléfono empieza una distinta.
            </p>
          </>
        )}

        <EntryForm adminDoor={adminDoor} guestAlready={player !== null} />
      </div>
    </main>
  );
}
