import type { ReactNode } from 'react';
import { getCurrentUser } from '@/lib/auth';

/**
 * Admin shell.
 *
 * This is NOT the security boundary. In the App Router a layout and its page
 * render in parallel, so hiding children here would still let the page run its
 * queries and ship the result inside the RSC payload. Every admin page calls
 * requireAdminPage() itself, and every server action calls requireAdmin().
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();

  return (
    <main className="shell">
      {user ? (
        <p className="small muted">
          Sesion: {user.email} - rol <strong>{user.role}</strong>
        </p>
      ) : null}
      {children}
    </main>
  );
}
