import Image from 'next/image';
import Link from 'next/link';

export default function HomePage() {
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
          <Link className="btn" href="/admin/species">
            Panel admin
          </Link>
        </div>
      </div>
    </main>
  );
}
