"""
QUITAR EL FONDO PLANO DE UNA LÁMINA, en lote.

El arte llega con un fondo liso —negro o blanco— y la base de datos quiere un
PNG con transparencia. Hacerlo a mano una por una es una tarde; esto lo hace en
segundos y, sobre todo, lo hace IGUAL en todas, que a ojo no pasa.

Tres decisiones, y las tres existen por un fallo concreto que se ve en la
pantalla:

1. **Se inunda desde el BORDE, no se borra un color.** "Quitar todo lo negro"
   le comería las alas a una kriatura de ópalo negro, los ojos a cualquiera y
   el contorno a todas. El fondo es lo que está PEGADO al borde y conectado con
   él; un negro rodeado de dibujo no es fondo, es dibujo.

2. **El borde se suaviza en vez de cortarse.** Un recorte duro deja el diente
   de sierra que delata una imagen recortada a máquina. Los píxeles de la
   frontera conservan alfa parcial según lo lejos que estén del color del
   fondo.

3. **Y se le DESCUENTA el fondo a ese borde.** Un píxel medio transparente
   sobre negro es el color real ya mezclado con negro: si se deja tal cual, la
   lámina sale con una orla oscura que se ve en cuanto la pones sobre el tema
   claro. Se invierte la mezcla (`c = (observado − fondo·(1−a)) / a`), que es la
   diferencia entre un recorte que parece hecho a mano y uno que no.

Uso:

    python scripts/quitar-fondo.py arte/entrada --salida arte/listas
    python scripts/quitar-fondo.py una.png --tolerancia 48
    python scripts/quitar-fondo.py arte/entrada --recortar   # además, al contenido

No toca nada del juego: lee imágenes y escribe PNGs.
"""

from __future__ import annotations

import argparse
import sys
from collections import deque
from pathlib import Path

try:
    import numpy as np
    from PIL import Image
except ImportError:  # pragma: no cover - mensaje, no rastro
    sys.exit("Falta Pillow o numpy. Instálalos con: python -m pip install Pillow numpy")


EXTENSIONES = {".png", ".jpg", ".jpeg", ".webp"}


def color_del_fondo(pixeles: np.ndarray) -> tuple[np.ndarray, bool]:
    """
    El color del fondo, tomado de las CUATRO esquinas.

    Se toman las cuatro y se exige que se parezcan: si no se parecen, el fondo
    no es plano —es un degradado o una escena— y esta herramienta no es la
    adecuada. Mejor avisar que entregar media kriatura comida.
    """
    alto, ancho = pixeles.shape[:2]
    esquinas = np.stack(
        [
            pixeles[0, 0, :3],
            pixeles[0, ancho - 1, :3],
            pixeles[alto - 1, 0, :3],
            pixeles[alto - 1, ancho - 1, :3],
        ]
    ).astype(np.int16)

    media = esquinas.mean(axis=0)
    plano = bool(np.all(np.abs(esquinas - media) <= 12))
    return media, plano


def mascara_de_fondo(rgb: np.ndarray, fondo: np.ndarray, tolerancia: float) -> np.ndarray:
    """
    Qué píxeles son fondo: los que se parecen al color del fondo **y** llegan
    hasta el borde sin cruzar el dibujo.

    Es un relleno por inundación desde todo el perímetro. Lo que la hace segura
    es justo lo que la hace más lenta que un `color == fondo`: respeta lo que
    está dentro.
    """
    alto, ancho = rgb.shape[:2]
    distancia = np.sqrt(((rgb.astype(np.float32) - fondo) ** 2).sum(axis=2))
    parecido = distancia <= tolerancia

    visitado = np.zeros((alto, ancho), dtype=bool)
    cola: deque[tuple[int, int]] = deque()

    def sembrar(y: int, x: int) -> None:
        if parecido[y, x] and not visitado[y, x]:
            visitado[y, x] = True
            cola.append((y, x))

    for x in range(ancho):
        sembrar(0, x)
        sembrar(alto - 1, x)
    for y in range(alto):
        sembrar(y, 0)
        sembrar(y, ancho - 1)

    while cola:
        y, x = cola.popleft()
        if y > 0:
            sembrar(y - 1, x)
        if y + 1 < alto:
            sembrar(y + 1, x)
        if x > 0:
            sembrar(y, x - 1)
        if x + 1 < ancho:
            sembrar(y, x + 1)

    return visitado, distancia


def huecos_cerrados(
    parecido: np.ndarray, borde_conectado: np.ndarray, area_minima: int
) -> tuple[np.ndarray, list[int]]:
    """
    Bolsas del color del fondo que NO llegan al borde: el negro que queda
    encerrado entre dos colas o dentro de un aro.

    La inundación no puede alcanzarlas por definición, así que sin esto se
    quedan como manchas oscuras que solo se ven cuando la lámina ya está sobre
    el tema claro.

    Es la parte delicada de toda la herramienta, porque un OJO también es una
    bolsa oscura encerrada. Dos cosas lo hacen seguro: solo entran las bolsas
    que están dentro de la tolerancia ESTRICTA del color del fondo —un ojo
    pintado casi nunca es el negro exacto del lienzo— y cada relleno se
    IMPRIME, con su tamaño, para que nadie se entere tarde.
    """
    alto, ancho = parecido.shape
    candidato = parecido & ~borde_conectado
    visto = np.zeros_like(candidato)
    relleno = np.zeros_like(candidato)
    areas: list[int] = []

    for y0, x0 in zip(*np.nonzero(candidato)):
        if visto[y0, x0]:
            continue
        bolsa = [(int(y0), int(x0))]
        visto[y0, x0] = True
        cola: deque[tuple[int, int]] = deque(bolsa)
        while cola:
            y, x = cola.popleft()
            for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < alto and 0 <= nx < ancho and candidato[ny, nx] and not visto[ny, nx]:
                    visto[ny, nx] = True
                    cola.append((ny, nx))
                    bolsa.append((ny, nx))
        if len(bolsa) >= area_minima:
            for y, x in bolsa:
                relleno[y, x] = True
            areas.append(len(bolsa))

    return relleno, sorted(areas, reverse=True)


def vecindad(mascara: np.ndarray, radio: int) -> np.ndarray:
    """La máscara engordada `radio` píxeles: dónde toca el fondo."""
    crecida = mascara.copy()
    for _ in range(max(radio, 0)):
        siguiente = crecida.copy()
        siguiente[1:, :] |= crecida[:-1, :]
        siguiente[:-1, :] |= crecida[1:, :]
        siguiente[:, 1:] |= crecida[:, :-1]
        siguiente[:, :-1] |= crecida[:, 1:]
        crecida = siguiente
    return crecida


def limpiar(
    ruta: Path,
    destino: Path,
    tolerancia: float,
    suavizado: float,
    recortar: bool,
    borde_px: int,
    area_hueco: int,
    ancho_max: int,
    voltear: bool,
) -> str:
    original = Image.open(ruta).convert("RGBA")
    pixeles = np.array(original)
    rgb = pixeles[:, :, :3]

    fondo, plano = color_del_fondo(pixeles)
    if not plano:
        return f"  {ruta.name}: AVISO, las esquinas no coinciden — ¿el fondo no es plano? No la toco."

    es_fondo, distancia = mascara_de_fondo(rgb, fondo, tolerancia)

    nota = ""
    if area_hueco > 0:
        estricta = distancia <= min(tolerancia, 30.0)
        relleno, areas = huecos_cerrados(estricta, es_fondo, area_hueco)
        if areas:
            es_fondo = es_fondo | relleno
            nota = f" + {len(areas)} hueco(s) cerrado(s) de {', '.join(str(a) for a in areas[:4])} px"

    """
    El alfa: 0 en el fondo, y en la frontera una rampa según lo lejos que esté
    cada píxel del color del fondo. `suavizado` es el ancho de esa rampa, en
    unidades de distancia de color.

    **La rampa solo se aplica donde el fondo TOCA.** Hacerlo por parecido de
    color a secas —que es lo que hacía— le ponía medio alfa a cualquier píxel
    oscuro, incluido el que está en mitad de un ala: a una kriatura de ópalo
    negro le salían agujeros por dentro mientras el contorno quedaba perfecto,
    que es la clase de fallo que no se ve hasta que la imagen ya está en el
    juego sobre el tema claro. Ser oscuro no es ser fondo; estar pegado al
    fondo, sí.
    """
    alfa = np.full(rgb.shape[:2], 255.0, dtype=np.float32)
    alfa[es_fondo] = 0.0

    frontera = vecindad(es_fondo, borde_px) & ~es_fondo & (distancia < tolerancia + suavizado)
    rampa = np.clip((distancia - tolerancia) / max(suavizado, 1e-6), 0.0, 1.0)
    alfa[frontera] = rampa[frontera] * 255.0

    """
    DESCONTAR EL FONDO del borde medio transparente. Sin esto, una lámina
    recortada sobre negro llega con una orla oscura alrededor que solo se ve
    cuando ya está en el juego, encima del tema claro.
    """
    a = (alfa / 255.0)[:, :, None]
    seguro = np.maximum(a, 1e-3)
    recuperado = (rgb.astype(np.float32) - fondo * (1.0 - a)) / seguro
    limpio = np.where(a > 0.004, recuperado, rgb.astype(np.float32))

    salida = np.dstack([np.clip(limpio, 0, 255), np.clip(alfa, 0, 255)]).astype(np.uint8)
    imagen = Image.fromarray(salida, mode="RGBA")

    if recortar:
        caja = imagen.getbbox()
        if caja:
            imagen = imagen.crop(caja)

    """
    Y se reduce. El arte llega a 1254 px y el juego la enseña a doscientos y
    pico en un movil: subir el original es pagar ancho de banda por pixeles que
    nadie va a ver, y el adaptador no admite mas de 2 MB. Se reduce aqui y no al
    servirla porque lo que se guarda es lo que viaja.
    """
    """
    TODAS MIRAN A LA IZQUIERDA.

    En la arena el rival va a la izquierda y los tuyos a la derecha, así que el
    juego voltea un lado para que se encaren. Eso solo funciona si sabe hacia
    dónde mira el dibujo, y un generador devuelve lo que le apetece. La norma se
    aplica AQUÍ, una vez, y no al dibujar: si cada pantalla tuviera que saber
    hacia dónde mira cada kriatura, haría falta una columna y cuatro sitios
    preguntándola.
    """
    if voltear:
        imagen = imagen.transpose(Image.FLIP_LEFT_RIGHT)

    if ancho_max > 0 and imagen.width > ancho_max:
        alto_nuevo = round(imagen.height * ancho_max / imagen.width)
        imagen = imagen.resize((ancho_max, alto_nuevo), Image.LANCZOS)

    destino.parent.mkdir(parents=True, exist_ok=True)
    imagen.save(destino, format="PNG", optimize=True)

    quitado = float(es_fondo.mean()) * 100
    peso = destino.stat().st_size / 1024
    return (
        f"  {ruta.name} → {destino.name}  "
        f"({quitado:.0f}% de fondo fuera, {imagen.width}×{imagen.height}, {peso:.0f} KB){nota}"
    )


def main() -> None:
    """
    La consola de Windows viene en cp1252 y revienta con una flecha o una tilde.
    Un informe que no se puede imprimir es una herramienta que no se puede usar.
    """
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

    parser = argparse.ArgumentParser(description="Quita un fondo plano y deja PNG con transparencia.")
    parser.add_argument("entrada", help="Una imagen o una carpeta con imágenes.")
    parser.add_argument("--salida", default=None, help="Carpeta de salida (por defecto, <entrada>/listas).")
    parser.add_argument(
        "--tolerancia",
        type=float,
        default=32.0,
        help="Cuánto puede alejarse un píxel del color del fondo y seguir siendo fondo (0-441).",
    )
    parser.add_argument(
        "--suavizado",
        type=float,
        default=28.0,
        help="Ancho de la rampa del borde. Más alto, borde más suave.",
    )
    parser.add_argument("--recortar", action="store_true", help="Recorta al contenido al terminar.")
    parser.add_argument(
        "--borde",
        type=int,
        default=2,
        help="Cuántos píxeles alrededor del fondo pueden suavizarse. Lo demás es dibujo, por oscuro que sea.",
    )
    parser.add_argument(
        "--huecos",
        type=int,
        default=400,
        help="Area minima, en pixeles, de una bolsa de fondo encerrada para rellenarla. 0 la desactiva.",
    )
    parser.add_argument(
        "--ancho",
        type=int,
        default=768,
        help="Ancho maximo en pixeles. 0 deja el original.",
    )
    parser.add_argument(
        "--voltear",
        action="store_true",
        help=(
            "Refleja la lamina en horizontal. El convenio es que TODAS miren a la izquierda, "
            "porque la arena voltea un lado para que los dos equipos se encaren."
        ),
    )
    parser.add_argument(
        "--resplandor",
        action="store_true",
        help=(
            "Preajuste para arte que BRILLA sobre negro: el halo se desvanece en el fondo "
            "en vez de cortarse, asi que la banda que puede suavizarse es mucho mas ancha."
        ),
    )
    args = parser.parse_args()

    if args.resplandor:
        """
        Un halo no tiene borde: es un degradado que termina en el color del
        fondo. Con la banda estrecha de siempre, la parte media del degradado
        -oro muy oscuro- no se parece lo bastante al negro para quitarse y se
        queda opaca: manchas negras alrededor de la kriatura que solo aparecen
        cuando la lamina ya esta sobre el tema claro.
        """
        if parser.get_default("tolerancia") == args.tolerancia:
            args.tolerancia = 40.0
        if parser.get_default("suavizado") == args.suavizado:
            args.suavizado = 150.0
        if parser.get_default("borde") == args.borde:
            args.borde = 120

    entrada = Path(args.entrada)
    if not entrada.exists():
        sys.exit(f"No existe: {entrada}")

    if entrada.is_file():
        laminas = [entrada]
        base = entrada.parent
    else:
        laminas = sorted(p for p in entrada.rglob("*") if p.suffix.lower() in EXTENSIONES)
        base = entrada

    salida = Path(args.salida) if args.salida else base / "listas"
    if not laminas:
        sys.exit(f"No encontré imágenes en {entrada}")

    print(f"{len(laminas)} lámina(s) → {salida}")
    for lamina in laminas:
        if salida in lamina.parents:
            continue
        relativa = lamina.relative_to(base) if lamina != base else Path(lamina.name)
        destino = salida / relativa.with_suffix(".png")
        print(
            limpiar(
                lamina,
                destino,
                args.tolerancia,
                args.suavizado,
                args.recortar,
                args.borde,
                args.huecos,
                args.ancho,
                args.voltear,
            )
        )


if __name__ == "__main__":
    main()
