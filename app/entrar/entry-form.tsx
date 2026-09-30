'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { type EntryState, enterAsAdminAction, enterAsGuestAction } from './actions';

function Pending({ label, primary }: { label: string; primary?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button className={primary ? 'btn-primary' : ''} type="submit" disabled={pending}>
      {pending ? 'Preparando…' : label}
    </button>
  );
}

export function EntryForm({
  adminDoor,
  guestAlready,
}: {
  adminDoor: boolean;
  /** With a game already going, "empezar" would silently abandon it. */
  guestAlready?: boolean;
}) {
  const [guest, enterAsGuest] = useActionState(enterAsGuestAction, { ok: false } satisfies EntryState);
  const [admin, enterAsAdmin] = useActionState(enterAsAdminAction, { ok: false } satisfies EntryState);

  return (
    <>
      {guest.message ? <p className="notice notice-error">{guest.message}</p> : null}
      {admin.message ? <p className="notice notice-error">{admin.message}</p> : null}

      {guestAlready ? null : (
        <form action={enterAsGuest}>
          <Pending primary label="Empezar a jugar" />
        </form>
      )}

      {adminDoor ? (
        <form action={enterAsAdmin} style={{ marginTop: '0.8rem' }}>
          <Pending label="Entrar al panel" />
        </form>
      ) : null}
    </>
  );
}
