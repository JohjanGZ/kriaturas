import Image from 'next/image';
import Link from 'next/link';
import { isAdmin } from '@/lib/auth';

export default async function HomePage() {
  /**
   * The admin button is drawn for admins, or offered as the DOOR when the
   * server has one open. A guest used to see "Panel admin" here and get bounced
   * to a refusal page for tapping it, which is a button that exists to say no.
   */
  const admin = await isAdmin();
  const door = process.env.ALLOW_ADMIN_ENTRY === 'true';

  return (
    <main className="shell">
      <div className="hero">
        <Image
          src="/brand/logo-full.png"
          alt="Kriaturas"
          width={900}
          height={450}
          className="hero-logo"
          priority
        />
        <p className="muted">
          Match-3 de colección. Alinea gemas del elemento de tu kriatura para cargar su maná;
          cuando la barra se llena, su ataque sale con el efecto.
        </p>
        <div className="row">
          <Link className="btn btn-primary" href="/jugar">
            Jugar
          </Link>
          <Link className="btn" href="/huevos">
            Incubadora
          </Link>
          {admin ? (
            <Link className="btn" href="/admin/species">
              Panel
            </Link>
          ) : door ? (
            <Link className="btn" href="/admin/acceso" prefetch={false}>
              Entrar como admin
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
