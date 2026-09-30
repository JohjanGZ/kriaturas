import { redirect } from 'next/navigation';

/**
 * "Mis kriaturas" ES el corral.
 *
 * El listado que vivía aquí enseñaba lo mismo que el corral —elemento, marca,
 * números ajustados por la temporada, stamina y el botón de cuidar— pero como
 * una tabla. El corral lo enseña como un sitio donde los bichos están, que es
 * lo que son.
 *
 * La ruta se queda como REDIRECCIÓN y no se borra: hay enlaces, marcadores y
 * revalidaciones que apuntan aquí, y un 404 por una reorganización nuestra es
 * un problema que le creamos al jugador.
 */
export default function CreaturesPage() {
  redirect('/corral');
}
