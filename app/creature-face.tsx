import { CreatureArt, type ArtElement } from './creature-art';

/**
 * LA CARA DE UNA KRIATURA: el dibujo de verdad si lo hay, el de relleno si no.
 *
 * Existe porque el arte subida se estaba quedando guardada y sin enseñar — el
 * corral leía `base_image_path` de la base de datos y después escribía
 * `imageUrl: null`, y la arena y el selector llamaban siempre al SVG. Una
 * lámina que está en la base de datos y en el CDN pero no se dibuja en ningún
 * sitio es trabajo tirado, y el fallo es invisible: todo parece correcto porque
 * el relleno SIEMPRE dibuja algo.
 *
 * Un solo sitio que decida, y los tres de antes preguntándole. El relleno deja
 * de ser "lo que se ve" para ser lo que siempre debió ser: lo que se ve
 * MIENTRAS no haya dibujo.
 *
 * **Todas las láminas miran a la IZQUIERDA.** No es un gusto, es que en la
 * arena el rival va a la izquierda y los tuyos a la derecha: si cada dibujo
 * mirase hacia donde quiso el generador, media plantilla pelearía de espaldas.
 * La norma se aplica al IMPORTAR (`quitar-fondo.py --voltear`), no al dibujar,
 * para que ninguna pantalla tenga que saber hacia dónde mira una kriatura
 * concreta.
 */
export function CreatureFace({
  imageUrl,
  element,
  name,
  className,
}: {
  /** El `public_id` ya resuelto a URL, o null si la especie no tiene arte. */
  imageUrl: string | null;
  element: ArtElement;
  name: string;
  className?: string;
}) {
  if (imageUrl) {
    return (
      /**
       * `alt` vacío a propósito: al lado va siempre el nombre en texto, así que
       * un lector de pantalla que lea los dos dice el nombre dos veces.
       */
      // eslint-disable-next-line @next/next/no-img-element
      <img className={className} src={imageUrl} alt="" loading="lazy" decoding="async" />
    );
  }

  return <CreatureArt element={element} name={name} className={className} />;
}
