# Subirlo a un servidor

Para poder abrirlo en el teléfono y enseñárselo a alguien sin que instale nada.

## Lo que hay que saber antes

Tres cosas del proyecto cambian al salir del portátil:

1. **La base de datos.** En local es PGlite: un directorio `.pglite` dentro del repo. Un
   servidor no tiene ese directorio ni disco donde escribirlo, así que hace falta un Postgres
   de verdad. El código ya lo soporta: `db/client.ts` elige el driver mirando `DATABASE_URL`, y
   esa cadena es **la única diferencia** entre local y producción.
2. **No hay login.** En local `lib/auth` usa la cuenta sembrada; en producción ese apaño está
   desactivado a propósito. Por eso existe **`/entrar`**: un botón que crea una partida de
   invitada y te deja su cookie. Sin eso, el juego desplegado le diría «no hay jugador» a todo
   el mundo.
3. **Las imágenes van a Cloudinary.** El adaptador local escribe en `public/uploads`, y en un
   servidor de este tipo el disco es de solo lectura. Con las tres variables de Cloudinary
   puestas, las subidas van allí; sin ellas se usa el disco y en el servidor fallan con un
   mensaje que lo explica.

## Pasos

### 1. Una base de datos Postgres

[Neon](https://neon.tech) tiene plan gratis y es contra lo que está construido esto. Crea un
proyecto y copia la cadena de conexión (`postgresql://...?sslmode=require`).

Cualquier Postgres accesible por internet sirve igual.

### 2. Crear las tablas y los datos

Desde tu máquina, apuntando a la base remota:

```bash
DATABASE_URL="postgresql://...?sslmode=require" npm run db:setup
```

Eso aplica las migraciones y siembra especies, poderes, objetivos y la cuenta de
administración. Es la única vez que hay que hacerlo a mano: los despliegues siguientes solo
necesitan `db:migrate` si has generado una migración nueva.

### 3. Subir el repositorio

El proyecto ya está en `https://github.com/JohjanGZ/kriaturas.git`. Asegúrate de tener subido
lo último:

```bash
git add -A
git commit -m "..."
git push
```

### 4. Conectarlo a Vercel

1. Entra en [vercel.com](https://vercel.com) con tu cuenta de GitHub.
2. **Add New → Project** y elige el repositorio `kriaturas`.
3. No toques la configuración de build: detecta Next.js solo.
4. En **Environment Variables** añade:

   | nombre | valor |
   | ------ | ----- |
   | `DATABASE_URL` | la cadena de Neon, la misma del paso 2 |
   | `ALLOW_ADMIN_ENTRY` | `true` **solo si** quieres llegar al panel desde el móvil |
   | `CLOUDINARY_CLOUD_NAME` | el *cloud name* de tu cuenta de Cloudinary |
   | `CLOUDINARY_API_KEY` | la clave pública (numérica) |
   | `CLOUDINARY_API_SECRET` | el secreto — solo aquí, nunca en el repo |

5. **Deploy**. En un par de minutos tienes una URL tipo `kriaturas.vercel.app`.

Abre esa URL en el teléfono, pulsa **Empezar a jugar** y ya estás dentro con tus propias
kriaturas.

### 5. Los cambios siguientes

Cada `git push` a `main` despliega solo. Tarda un par de minutos, así que para iterar deprisa
sigue siendo mejor el portátil; el servidor es para probar en el móvil de verdad y para
enseñarlo.

## Cuidado con esto

- **`ALLOW_ADMIN_ENTRY` le da el panel a quien pulse el botón.** No hay login: cualquiera con el
  enlace puede entrar a administrar. Déjalo apagado si vas a compartir la URL, y enciéndelo solo
  mientras lo pruebas tú.
- **Cada invitada es una partida distinta**, guardada en la cookie de ese navegador. Si borras
  las cookies, esa partida se queda huérfana. Es a propósito: una cuenta compartida no serviría,
  porque solo se permite una batalla activa por jugador y dos personas a la vez se pisarían.
- **Una migración nueva no se aplica sola.** Después de `npm run db:generate` hay que correr
  `DATABASE_URL=... npm run db:migrate` contra la base remota, o el despliegue nuevo hablará con
  un esquema viejo.

## Probarlo en el móvil sin desplegar nada

Si el teléfono está en la misma wifi que el portátil, esto es instantáneo y no necesita
servidor ni base remota:

```bash
npx next dev -p 3210 -H 0.0.0.0
```

Y en el teléfono abre `http://<ip-del-portatil>:3210` (la IP sale con `ipconfig`). Los cambios
se recargan al guardar, igual que en el portátil. Para iterar es mucho mejor que desplegar; el
despliegue es para cuando quieras enseñárselo a alguien que no está en tu casa.
