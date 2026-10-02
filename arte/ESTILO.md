# El estilo de las kriaturas

Esto es lo que se pega en un generador de imágenes para que una kriatura nueva parezca del mismo
juego que las que ya existen. No es documentación: es material de trabajo.

**La coherencia no sale de pedir "buena calidad", sale de repetir lo mismo.** El preámbulo de
abajo no se toca entre una kriatura y otra — lo único que cambia es el bloque del animal. Si una
sale distinta al resto, casi siempre es porque alguien reescribió el preámbulo "para mejorarlo".

---

## 1. El preámbulo fijo

Va SIEMPRE, palabra por palabra, al principio de cada petición:

```
Anime-style creature design for a collectible monster game, full body, 3/4 view,
single creature centered in frame, facing left, standing or mid-stride.
Clean confident lineart, cel shading with soft gradients, luminous saturated palette,
inner glow on the elemental parts of the body.
Small geometric rhombus and diamond markings on the fur, plus a few floating sparkles
and motes of light around the creature.
Pure flat black background, nothing else in the scene.
No text, no watermark, no signature, no border, no frame, no character sheet,
no multiple views, no ground shadow.
Square image, high resolution.
```

Tres cosas de ahí no son estéticas y **no se pueden quitar**:

- **`Pure flat black background`** — es lo que hace que `scripts/quitar-fondo.py` pueda recortarla.
  Un fondo con degradado, viñeta o escenario obliga a recortar a mano.
- **`no text, no watermark, no signature`** — cualquier letra se queda pegada para siempre, porque
  el recortador no la distingue del dibujo.
- **`no ground shadow`** — una sombra bajo las patas es una mancha gris que, recortada, deja a la
  kriatura flotando sobre un charco.

## 2. La paleta, por elemento

El jugador tiene que reconocer el elemento antes de leer el nombre, así que el color no es
decisión por kriatura: es decisión por elemento.

| elemento | lo que se pide |
| --- | --- |
| **fuego** | `warm orange and amber palette, cream underbelly, flame-shaped fur, deep red accents` |
| **agua** | `cool cyan and deep blue palette, pale aqua underbelly, flowing translucent fins, white foam accents` |
| **planta** | `fresh green and moss palette, pale cream underbelly, leaf and petal shapes, warm amber accents` |
| **psíquico** | `violet and magenta palette, pale lilac underbelly, iridescent opal panels, soft pink glow` |

Y los **evolucionados**, solo para la forma excelente:

| superior | lo que se pide |
| --- | --- |
| **luz** (de fuego) | `golden and warm white palette, radiant halo, crescent crown of light above the head` |
| **hielo** (de agua) | `pale ice blue and white palette, crystalline shards, frost patterns` |
| **veneno** (de planta) | `toxic purple and acid green palette, dripping translucent spines` |
| **astral** (de psíquico) | `deep indigo and black palette with starfield shimmer, black opal panels` |

## 3. Las tres formas

El archivo manda: `base.png` es la forma inicial, `evolucion.png` la vía normal y `exelent.png` la
superior.

**Las dos evoluciones NO se generan desde cero.** Se sube la lámina base al generador y se le pide
la variación. Es la única forma de que sean *el mismo animal* a tres estados en vez de tres bichos
que se parecen, y el error más caro de todo esto es gastar el día generando tres criaturas
distintas.

### base.png — la forma inicial

Preámbulo + paleta del elemento + el bloque del animal (ver abajo).

### evolucion.png — la vía normal

Sube `base.png` y pide:

```
Same creature as the reference image, same species, same markings, same eye color,
same color palette. Now in its adult form: larger, taller, more confident posture,
longer fur and bigger elemental features. Keep the exact same lineart style,
shading and pure flat black background.
```

La vía normal es **otro dibujo, no otro color**: mantiene el elemento. Si sale de otro color, está
mal.

### exelent.png — la forma excelente ✦

Sube `base.png` y pide lo mismo, cambiando la paleta por la del **elemento superior**:

```
Same creature as the reference image, same species, same markings, same silhouette.
Now in its ascended form: [paleta del superior], regal posture, eyes closed or half-lidded.
Keep the exact same lineart style, shading and pure flat black background.
```

Esta sí cambia de color, y debe hacerlo: es la que solo alcanzan las kriaturas con la marca ✦.

## 4. El bloque del animal

Lo único que se escribe de cero por kriatura. Tres frases, y en este orden:

1. **qué animal es** — concreto, no "monstruo": zorro, polilla, tortuga, ciervo;
2. **qué le hace el elemento** — dónde está el fuego, el agua, las hojas;
3. **qué carácter tiene** — y esto sale en la CARA y en la postura, que es lo que se recuerda.

Ejemplo real, el que daría para una kriatura de agua inspirada en la vaquita marina:

```
A small round porpoise-like creature with a soft grey-blue body and a pale belly,
smooth skin instead of fur. Dark rings around the eyes like a mask.
Water gathers in translucent fins along its back and a trailing ribbon of water behind it.
Shy and gentle expression, looking slightly away from the viewer, as if it would rather
not be seen.
```

## 5. La comprobación, antes de recortar

Cuatro cosas, y se ven en tres segundos:

- ¿el fondo es negro **plano**, sin degradado ni viñeta?
- ¿hay alguna letra, firma o marca en alguna esquina?
- ¿está la kriatura **entera**, sin que ninguna cola o ala toque el borde?
- ¿se parece a la base, en las tres láminas?

Si las cuatro están bien, sigue el camino de siempre:

```
python scripts/quitar-fondo.py .kriaturas --salida .kriaturas/listas --resplandor
npx tsx scripts/subir-arte.ts .kriaturas/listas
```
