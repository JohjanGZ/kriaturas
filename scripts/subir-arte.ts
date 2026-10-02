import 'dotenv/config';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { imageStorage, storageKind } from '@/lib/storage';

/**
 * SUBE EL ARTE DE UNA TANDA y dice qué identificador le tocó a cada lámina.
 *
 * Es una herramienta de desarrollo, no parte del juego, y va por el MISMO
 * adaptador que el panel de admin (`lib/storage`): si el panel sabe subir, esto
 * sabe subir, y el día que el almacenamiento cambie no hay un segundo sitio que
 * actualizar. Por eso tampoco elige destino — lo elige el entorno, Cloudinary
 * cuando están sus tres credenciales y el disco local si no.
 *
 * Lo que imprime es lo que importa: **el `public_id`, no una URL**. La base de
 * datos guarda identificadores precisamente para que `urlFor` decida el CDN y
 * las transformaciones al dibujar, así que lo que hay que copiar al seed es esa
 * cadena.
 *
 * Espera láminas YA RECORTADAS — primero `quitar-fondo.py`, después esto. Son
 * dos pasos porque son dos trabajos, y el primero hay que mirarlo con los ojos
 * antes de mandar nada a un servidor.
 *
 *   python scripts/quitar-fondo.py .kriaturas --salida .kriaturas/listas --resplandor
 *   npx tsx scripts/subir-arte.ts .kriaturas/listas
 *   npx tsx scripts/subir-arte.ts .kriaturas/listas/flariny   # una sola
 */

const TIPOS: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * Los tres nombres de archivo, y sus variantes.
 *
 * `exelent`, `excelent` y `excellent` son la misma lámina escrita de tres
 * formas: el nombre del archivo lo teclea una persona a las dos de la mañana y
 * rechazarlo por una ele es hacerle perder el tiempo por nada.
 */
const RANURAS: Record<string, string> = {
  base: 'base',
  evolucion: 'normal',
  evolución: 'normal',
  normal: 'normal',
  exelent: 'superior',
  excelent: 'superior',
  excellent: 'superior',
  superior: 'superior',
};

type Subida = { kriatura: string; ranura: string; publicId: string; bytes: number };

async function laminasDe(carpeta: string): Promise<string[]> {
  const entradas = await readdir(carpeta, { withFileTypes: true });
  return entradas
    .filter((e) => e.isFile() && TIPOS[path.extname(e.name).toLowerCase()])
    .map((e) => path.join(carpeta, e.name));
}

async function subirCarpeta(carpeta: string, almacen = imageStorage()): Promise<Subida[]> {
  const kriatura = path.basename(carpeta).toLowerCase();
  const hechas: Subida[] = [];

  for (const lamina of await laminasDe(carpeta)) {
    const extension = path.extname(lamina).toLowerCase();
    const nombre = path.basename(lamina, extension).toLowerCase();
    const ranura = RANURAS[nombre];
    if (!ranura) {
      console.log(`  ${kriatura}/${nombre}${extension}: no sé qué forma es, la salto`);
      continue;
    }

    const datos = await readFile(lamina);
    const guardada = await almacen.put({
      data: datos,
      contentType: TIPOS[extension]!,
      /**
       * El adaptador lo pide y después NO lo usa para nombrar nada: el id lo
       * genera el servidor. Va por el registro y por si algún día un adaptador
       * quiere conservar la extensión.
       */
      filename: path.basename(lamina),
      /** La carpeta remota lleva el nombre de la kriatura: encontrarla después. */
      prefix: kriatura,
    });

    hechas.push({ kriatura, ranura, publicId: guardada.key, bytes: guardada.size });
    console.log(`  ${kriatura} · ${ranura.padEnd(8)} → ${guardada.key}  (${Math.round(guardada.size / 1024)} KB)`);
  }

  return hechas;
}

async function main(): Promise<void> {
  const destino = process.argv[2];
  if (!destino) {
    console.error('Uso: npx tsx scripts/subir-arte.ts <carpeta>');
    process.exit(1);
  }

  const info = await stat(destino).catch(() => null);
  if (!info?.isDirectory()) {
    console.error(`No es una carpeta: ${destino}`);
    process.exit(1);
  }

  console.log(`Almacenamiento: ${storageKind()}`);
  if (storageKind() === 'local') {
    console.log(
      '  AVISO: sin las credenciales de Cloudinary esto escribe en public/uploads,\n' +
        '  que no existe en el servidor desplegado. Revisa .env antes de seguir.',
    );
  }

  /** Una carpeta de kriaturas, o la carpeta de UNA kriatura. */
  const dentro = await readdir(destino, { withFileTypes: true });
  const carpetas = dentro.filter((e) => e.isDirectory()).map((e) => path.join(destino, e.name));
  const objetivos = carpetas.length > 0 ? carpetas : [destino];

  const todas: Subida[] = [];
  for (const carpeta of objetivos) {
    todas.push(...(await subirCarpeta(carpeta)));
  }

  if (todas.length === 0) {
    console.log('No subí nada: ninguna lámina con nombre reconocible.');
    return;
  }

  /**
   * El resumen sale como las líneas que hay que pegar en el seed, no como una
   * tabla bonita: lo siguiente que pasa con esto es copiarlo.
   */
  console.log(`\n${todas.length} lámina(s). Para el seed:\n`);
  for (const kriatura of [...new Set(todas.map((s) => s.kriatura))]) {
    const suyas = todas.filter((s) => s.kriatura === kriatura);
    console.log(`  // ${kriatura}`);
    for (const s of suyas) console.log(`  ${s.ranura}: '${s.publicId}',`);
  }
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
