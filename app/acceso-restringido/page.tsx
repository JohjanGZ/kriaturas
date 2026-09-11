export default function AccessDeniedPage() {
  return (
    <main className="shell">
      <h1>Acceso restringido</h1>
      <div className="card">
        <p>
          Esta sección exige una cuenta con rol <code>admin</code>. El rol se lee de la base
          de datos en el servidor en cada petición: no hay forma de concederlo desde el
          navegador.
        </p>
        <p className="small muted">
          Todavía no hay sistema de login. En desarrollo se usa la cuenta que siembra{' '}
          <code>npm run db:seed</code>; si no aparece, ejecútalo.
        </p>
      </div>
    </main>
  );
}
