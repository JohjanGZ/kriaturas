# Kriaturas

Juego match-3 de criaturas. Alineas gemas de los cuatro elementos, eso carga la barra de maná
de tus kriaturas, y cuando una se llena sale su poder especial. El rival es un bot que juega
**tu mismo tablero**: las gemas que le dejas son las que se lleva.

Next.js (App Router) + TypeScript, Drizzle ORM, PGlite en local y Postgres en el servidor.

## Empezar

```bash
npm install
cp .env.example .env     # DATABASE_URL="file:./.pglite" ya viene puesto
npm run db:setup         # crea las tablas y siembra especies, poderes y objetivos
npm run dev              # http://localhost:3210
```

```bash
npm test                 # 250 pruebas
npm run typecheck
npm run match3           # jugar una batalla en la terminal
```

## Dónde está cada cosa

| carpeta | qué hay |
| ------- | ------- |
| `core/` | el juego como funciones puras: match-3, combate, efectos, campos, balance |
| `db/` | esquema, migraciones y consultas |
| `app/` | rutas y UI, incluido el panel de administración |
| `tests/` | pruebas unitarias del núcleo |

`core/` no importa Next, React ni nada de `db/`: está pensado para que un segundo juego lo
reutilice tal cual.

## Documentación

- **[CLAUDE.md](CLAUDE.md)** — cómo funciona y, sobre todo, **por qué** cada decisión es la que
  es. Es el documento largo: las reglas del combate, por qué la stamina no se guarda como
  número, por qué los efectos son datos y no código.
- **[DEPLOY.md](DEPLOY.md)** — subirlo a un servidor para abrirlo en el móvil.

## Reglas que no se rompen

- **El servidor decide todo.** El cliente manda cuatro números (origen y destino del
  intercambio) y nada más. Ni el tablero, ni el daño, ni el maná, ni una fecha.
- **La stamina no se almacena.** Se deriva de `creatures.last_fed`, así que no hay número que
  falsear ni reloj del cliente que creer.
- **Las migraciones siempre se generan.** Nunca `drizzle-kit push`, ni en local.
