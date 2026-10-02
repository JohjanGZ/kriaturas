# Kriaturas

Match-3 creature-collecting game. Next.js (App Router) + TypeScript strict, Drizzle ORM,
PGlite locally, Neon Postgres + Cloudflare Workers in production.

## Folder rules

```
/core      domain logic: elements, stamina, balance, objectives, eggs, effects, match-3
/db        schema, migrations, client, seed
/app       Next.js routes and UI
/app/admin admin panel
/lib       adapters (image storage, ...)
/scripts   developer tools (terminal battle simulator)
/public/brand  logo assets (source/ holds the full-resolution originals)
/tests     unit tests
```

- **`/core` never imports Next.js, React, or anything under `/db`.** It is framework-free and
  storage-free because a second game will reuse it as-is. Data goes in as arguments, results
  come out as return values. `/db` may import `/core`; the dependency only points one way.
- **One DB module knows the driver.** `db/client.ts` picks PGlite or remote Postgres from
  `DATABASE_URL`. No other file may know which one is running. The only difference between
  local and production is that connection string.

## Elements

Four **base** elements — `fire`, `water`, `plant`, `psychic`. Evolved elements are an **open
set**: `light`, `ice`, `poison`, `astral`, `rock`, and more can be added (one array in
`core/elements.ts` plus a migration).

**The match-3 board only ever uses the four base elements — never the evolved ones.**
A creature always triggers on its **species base element**, transformed or not
(`triggerElementFor`); transforming only makes it hit harder
(`combat.evolvedDamageMultiplier`).
Never map an evolved element back to a base one: poison and rock can both come from plant, so
that mapping is not invertible.

### The four canonical pairs — the SUPERIOR element

| base    | superior element |
| ------- | ---------------- |
| fire    | light            |
| water   | ice              |
| plant   | poison           |
| psychic | astral           |

`CANONICAL_EVOLUTIONS` (`superiorElementFor`) is what an **excellent** creature transforms into.
An ordinary one keeps its own element. It is the prize of rarity, not a default.

## Evolution — IN BATTLE, temporary, and two grades

**There is no permanent evolution.** A creature is never upgraded for ever: it TRANSFORMS during
a fight, paid for with the drakofruta aligned on the board, and it goes back to itself when the
battle ends. Nothing writes to the creature row, and there is no evolution currency to save.

A species owns **two paths** (`evolution_paths`), told apart by where they point — the grade is
derived (`pathTier`), never a column that could contradict the target:

| grade | target | who gets it | bonuses |
| ----- | ------ | ----------- | ------- |
| normal | its OWN base element (fire → fire) | any creature | +10 HP, +5 attack, +3 defence |
| superior | the canonical pair (fire → light) | **excellent only** | +3 on each of those |

**Excellent is a permanent mark on the CREATURE** (`creatures.is_excellent`), decided when it is
born and never removed. It does two things, and nothing else:

1. the in-battle transformation takes the SUPERIOR path instead of the ordinary one;
2. **it is immune to a season's nerfs** (`effectiveAdjustment`) — it keeps every buff a season
   hands out and ignores every penalty. That is a large part of what makes the rare mark worth
   chasing: it survives the balance pass that flattens everyone else.

A nerf is not "a negative number", it is "worse", and worse points in a different direction per
stat: LESS attack is a nerf, MORE mana cost is a nerf too. Filtering by sign alone would protect
an excellent creature from a cheaper bar — a gift — and let an expensive one through.

`CANONICAL_EVOLUTIONS` in `core/elements.ts` is therefore no longer "the default path": it is the
PRIZE, the element only a rare creature reaches. `superiorElementFor` is the one place that
mapping lives, which is why the path is chosen in TypeScript rather than joined in SQL.

> An ordinary transformation keeps the element, so with the generated placeholder art it looks
> the same. That is expected: each path carries its own `image_path`, and the normal grade will
> be a different DRAWING, not a different colour.

## The WHITE creature — a species with no element

One species (`albo`) has **no element of its own**: `species.base_element` is NULL. It hatches
white, it **cannot be taken into a battle at all**, and an elemental stone later turns it into
one of four.

**Null, not a fifth element.** "No element" is an ABSENCE, and modelling it as a tenth enum
value would put it on the board, give it a palette and let it be picked — the four base elements
are what the board deals and nothing else may pretend to be one.

- **`creatures.element`** is what a stone writes, per creature. Null for every ordinary creature,
  whose element comes from its species. `resolveElement(speciesBase, creatureElement)` is the one
  place that rule lives, and everything asks it — a roster that disagreed with the picker would
  offer a fight the battle then refuses.
- **It cannot fight, and `startBattle` is the only place that says so.** No gem on the board
  charges it, so it would stand there for a whole battle doing nothing. The check runs before any
  stamina is spent, which is also why every query downstream may treat a battle's creatures as
  having an element (`coalesce(creatures.element, species.base_element)`).
- **Awakening is written ONCE**, guarded by `WHERE element IS NULL` rather than by a read then a
  write: two stones at the same instant would both pass a check made in TypeScript, and the
  second has to lose. A row constraint backs it up, so there is no creature with an element and
  no instant.
- **Four faces, one species** (`species_forms`, a row per species and base element). It is not
  four species that happen to share stats: only the NAME and the DRAWING change when the stone
  lands, and keeping it to those two is what stops one creature with four faces from quietly
  becoming four creatures sharing a row. A white species is also created with four evolution
  paths — one per element — so an awakened creature can still transform along its own.
- **White is drawn white and CROWNLESS** (`creature-art.tsx`). The missing crown is the point: at
  a glance it reads as unfinished rather than as a pale version of something else.
- **It is the rarest thing in the egg pool** (weight 1 against 4, about one hatch in sixty).
  The species is still rolled at PURCHASE and hidden until `status = 'hatched'`, so what the
  player experiences is finding it when the egg opens, with nothing to re-roll.

### La piedra elemental — el PERMISO para transformarse

La piedra y la drakofruta hacen trabajos distintos y por eso conviven: la piedra es el
**permiso**, se fusiona una vez y para siempre; la fruta es el **combustible**, se alinea cada
partida. **Sin piedra una kriatura alinea toda la fruta del mundo y no se transforma.**

`useElementStone` la compra y la usa en el mismo gesto, desde la ficha del corral. Hace **dos
cosas según a quién se le dé**, y esa es la respuesta a qué hacer con el Albo:

| a quién | qué piedra | qué hace |
| ------- | ---------- | -------- |
| una kriatura corriente | **la de su propio elemento** | le abre la evolución |
| una **blanca** | cualquiera de las cuatro | le da el elemento **y** le abre la evolución |

Una sola piedra por dos efectos es la compensación por nacer inservible, y es lo que impide que
el Albo sea un caso aparte con reglas propias: **es la misma pieza, usada por quien la necesita
para más cosas.** Y sigue siendo el blanco el único que ELIGE — cuatro botones, porque sortearlo
convertiría su gracia en una lotería; a una corriente la piedra no le plantea una decisión sino
una compra, y la decisión real es *a cuál de tus kriaturas le inviertes*.

- **Es un TECHO, no un muro.** Una kriatura sin piedra pelea igual: carga su barra, dispara su
  especial, gana partidas. Lo único que no puede es transformarse. Si bloquease la pelea entera
  sería un peaje; bloqueando solo lo mejor, es un antojo.
- **Se compra y se usa a la vez**, como la cura. No hace falta inventario todavía, y montar un
  almacén para una sola cosa sería construir la estantería antes que los libros.
- **Se escribe UNA vez**, con `WHERE evolution_unlocked_at IS NULL` dentro de la transacción: dos
  piedras usadas a la vez pasarían las dos una comprobación hecha en TypeScript, y la segunda no
  puede cobrar por nada. Si no se escribió ninguna fila, **no se cobra**.
- **Las gratis se gastan ANTES que las monedas** (`players.free_stones`). Quien tiene una regalada
  no paga, y no hay que elegir entre pagar o gastar la del cajón.
- `shop.elementStonePriceCoins` son **125**: estaba en 300 cuando la piedra era cosa del Albo —una
  eclosión de sesenta— y ahí daba igual. Queriéndola cada kriatura, 300 la dejaba costando más que
  el bicho (huevo 100 + electricidad 75). A 125 una kriatura nueva y transformable sale por unas
  300 monedas, seis victorias. Cuando lleguen las misiones la piedra será también lo que dan
  gratis — el mismo trato que la medicina: **las monedas compran tiempo, nunca perdón.**

#### Dónde vive el permiso, y por qué `undefined` significa SÍ

`creatures.evolution_unlocked_at` es la columna, y `Combatant.evolutionUnlocked` la lleva al
motor. Es **opcional**, y la ausencia se lee como que sí puede:

```ts
member.evolutionUnlocked !== false   // undefined = sí
```

El simulador de terminal y el bot construyen sus combatientes a mano y no saben de piedras. Con
el defecto al revés, un dato que nadie rellena le habría apagado la transformación a todo lo que
no pasa por la base de datos — y se habría descubierto como "el campo Vergel ya no hace nada".

**Y lo dicen los dos lados, como con el elemento repetido**: el combate lo rechaza
(`evolveInBattle` → `no_stone`) porque es quien manda, y la pantalla deja de ofrecerla porque un
botón que solo sirve para enseñar un error no es un botón. `canEvolveInBattle` tampoco anuncia la
barra llena si NINGUNA del equipo lleva piedra: celebrar un recurso que no se puede gastar es
peor que no celebrarlo.

- **En el corral** la kriatura sin piedra lleva un **◆** en la esquina —arriba a la izquierda, que
  el 🤒 ocupa la otra— y su ficha enseña el botón de fusionar. Fusionada no se dice nada: un aviso
  permanente de algo ya resuelto es ruido.
- **En el selector de equipo** se avisa pero **no se impide**: "◆ sin piedra: no se transforma".
  Decirlo ahí es lo que hace que la piedra se compre antes de la pelea y no se descubra a mitad.

#### La bienvenida: tres kriaturas evolucionables, y la lección en la primera eclosión

Las tres de regalo nacen **con la evolución abierta**. La transformación es lo mejor que tiene el
combate, y esconderla detrás de un paso de tutorial es guardarse la mejor carta: primero se ve,
después se aprende lo que cuesta.

La lección llega en la **primera eclosión**, que nace **bloqueada** y con una **piedra gratis**
esperando. Para entonces el jugador ya ha visto transformarse a las suyas, así que "necesito una
piedra" es un antojo y no un muro, y el primer bloqueo **trae su propia solución**: se aprende el
bucle entero en un gesto y solo la SEGUNDA cuesta monedas.

Tres y de elementos distintos, nunca dos iguales: un equipo son dos de elementos diferentes, así
que dos que compartieran elemento serían un rechazo que el jugador no entiende en su primer
minuto. Con tres distintos hay elección real —tres parejas posibles— y **le falta el cuarto**,
que es exactamente el antojo que hace querer el primer huevo. Y ninguna es la blanca: de tres
kriaturas una que no puede pelear mata un tercio del establo antes de empezar, y el Albo tiene
que ser un HALLAZGO del huevo.

> **Un selector que no sabe algo ofrece una pelea que el combate rechaza.** El de `/jugar` leía el
> elemento de la ESPECIE, así que una blanca ya despertada se quedaba fuera para siempre aunque
> `startBattle` la aceptase, y no sabía de enfermedades, así que ofrecía una enferma que el combate
> rechazaba después. Los dos leen ahora lo mismo: `resolveElement` y el techo de `staminaCeiling`.

> **Añadir una clave de config tiene DOS trampas, y las dos muerden en sitios distintos.**
>
> 1. **La escritura**: `game_configs.key` es un enum de Postgres, así que la clave nueva necesita
>    su `db:generate` o el seed revienta con `invalid input value for enum`.
> 2. **La lectura en PRODUCCIÓN**: allí solo corren las migraciones — el seed se lanza a mano y
>    una vez — así que la fila simplemente no existe, y `parseConfig(key, undefined)` tiraba la
>    página entera con *"expected object, received undefined"*. Un despliegue verde que rompe el
>    juego.
>
> Por eso `loadGameConfig` lee `?? {}`: una clave sin fila cae en los defaults que Zod ya
> declara, que es justo lo que la regla de esta casa promete. Las tres viejas (`stamina`, `play`,
> `combat`) no tienen defaults y siguen exigiendo su fila — correcto, porque esas nunca llegaron
> sin sembrar.

## Objectives — unlock requirements

`objectives` is an admin catalog: a **metric** (`matches_won`, `element_gems_cleared`,
`days_cared`, …), validated **params**, and a **target value**.

**They are TRACKED but gate nothing today.** They used to unlock the permanent evolution, which
no longer exists; the counters keep running because they are the raw material for whatever
unlock comes next (a shop, a season reward, the rare mark itself). `evolution_requirements`
still exists and is simply unused.

`objective_progress` tracks a counter per creature (`creature_id` set) or per player
(`creature_id` null). **Progress is only ever advanced server-side** from a resolved match or a
completed care day. The client never reports progress and no input schema accepts one.
`completed_at` is written once, so later edits to a target cannot un-complete what was earned.

## Eggs — bought, POWERED, hatched

An egg is bought from an `egg_types` row and yields a **random species** from that type's
weighted pool. `/huevos` is the incubator screen.

**The species is rolled server-side at purchase and stored immediately.** There is nothing to
re-roll and nothing the client can influence; it is simply not exposed by any query until
`status = 'hatched'`. The egg being opaque is the whole drama of an egg.

### The incubator is PAID FOR, not visited

An egg advances because its incubator had power that day, and power is bought with coins — the
electricity bill. That is the difference between this and a daily-attendance check, and it is
the whole design:

- **Paying writes ONE ROW PER DAY** into `egg_care_log`, future days included. The unique index
  on (egg, date) is what stops a day being paid twice, replayed or back-filled — the same guard
  the old daily-care model used, now guarding a purchase.
- **Progress is DERIVED**: paid days that have arrived (`poweredDays`). A stored counter is one
  more thing that can disagree with the log, so the log is the truth and the column is a mirror
  for the admin.
- **Being away costs nothing.** A day paid in advance arrives whether anybody opened the game or
  not. **Eggs no longer spoil at all** — `max_missed_days` and `spoiledRefundPercent` stay as
  unused columns. The stamina model already refuses to punish absence, and an egg bought with
  coins earned by playing must not be the one place that does.
- **The BATTERY is the product.** `incubators.capacity_days` is how far ahead power can be
  bought: the free one everybody is given holds **one day**, so a three-day egg wants three
  visits; the ones on sale hold three or seven and charge in a single payment. What is sold is
  **autonomy, never forgiveness** — an unpowered egg just sits still, so there is no punishment
  to buy protection from.
- **Prices are never sent by the client.** The egg price comes from its row, the electricity
  from `egg_types.electricity_cost`, the incubators from `eggs.incubatorsForSale` in config. The
  browser sends an id and a number of days.

### Why three days, and why the numbers interlock

`careDaysRequired` is 3 and the free battery is 1, and those two are chosen together:

| incubator | battery | recharges per egg |
| --------- | ------- | ----------------- |
| free      | 1 day   | **3** |
| bought    | 3 days  | **1** |

At two days the bought one barely saves anything; at six the free one becomes a punishment.
Three is the number that makes the upgrade worth buying without making the free one feel broken.

With a win paying 50 coins, an egg at 100 and electricity at 25/day, **a new creature costs
about 175 coins — three or four victories**. The real sink is running several at once:
`maxActiveEggsPerPlayer` is 5, so five eggs burn 125 coins a day just to keep the lights on.
That is the decision the system asks, and it asks a different one of a casual player than of an
intense one without changing a rule.

**The welcome egg** (`huevo-bienvenida`, 50 coins, one day) exists because the first hatch has to
arrive while the player is still curious. It is the moment that decides whether this has
progression or is only a series of battles.

## El corral — where the kriaturas live

`/corral` is the pen. `corrals` is a row per pen (capacity, price) and
`creatures.corral_id` says which one a creature lives in — the same shape as the incubators,
because two systems that behave alike are one system to learn.

**Capacity is the point.** Until now a player could hatch for ever and the roster just grew. A
ceiling turns "one more creature" into a decision and gives coins a second thing to buy.

- **A full corral REFUSES the newborn; it never makes room.** A ready egg stays exactly as it
  is — powered, paid for, waiting in its incubator — until there is a place. Nothing is deleted,
  ever. "One of yours died because you ran out of space" is what makes somebody close a game for
  good, and no rule in this project is allowed to produce that sentence.
- **The two capacities are SEPARATE.** An egg occupies an incubator slot while it incubates; a
  creature occupies a corral place once it hatches. Neither counts against the other.
- **Over capacity is possible and harmless.** Nothing evicts: the limit only refuses ARRIVALS, so
  a corral shrunk in config just stops accepting.
- **Creatures with no corral are adopted on sight.** Anything born before corrals existed gets a
  place when the page loads, rather than needing a data migration nobody remembers to run.

### Enfermar — el precio de exprimir a una kriatura

La regla cabe en una frase: **si la dejas seca, puede enfermar**. Y esa frase es lo que la
salva, porque la stamina solo baja JUGANDO — el modelo garantiza que la ausencia únicamente
puede subirla. Desaparecer una semana deja a las kriaturas **más** seguras, no menos, así que
esto nunca castiga por no estar. `core/health` lo resuelve, puro y con el azar inyectado.

- **Se tira UNA vez**, cuando la kriatura cae por debajo del mínimo para jugar. Tirar en cada
  partida suena parecido y no lo es: con cuatro partidas por sesión y un 20% cada una, **el 43%
  de las sesiones acabarían en enfermedad**. Una sola tirada lo deja en una de cada cinco, y
  crea la decisión de verdad — ¿juego la última o la dejo con algo en la barra?
- **Cero al 100%, no un 1%.** Un suelo significa que una kriatura puede enfermar sin que
  pudieras haberlo evitado, que es exactamente la sensación que esto evita. Cero es una promesa
  sobre la que decidir: aliméntala y está a salvo.
- **La curva es convexa** (`chance × (1 − stamina/máx)³`). Recta, media barra ya daría la mitad
  del riesgo y sería un impuesto constante; al cubo la zona segura es ancha y el peligro es un
  aviso claro al final: 0,3% a 15/20, 2,5% a 10/20, 8,4% a 5/20, 20% en seco.
- **Enferma es DÉBIL, no muerta.** La barra sigue subiendo con el techo al 25%
  (`staminaCeiling`), así que darle de comer sigue haciendo algo — "la comida no hace nada" se
  lee como un botón roto. Pero no puede pelear: dejarla entrar floja convertiría enfermar en un
  número peor en vez de un acontecimiento.
- **La comida no cura, ni por la puerta de atrás.** `feed` recorta el ancla al TECHO y no a la
  barra llena; si la arrastrara más atrás, la kriatura aparecería al máximo en el instante de
  curarse y la comida habría comprado la cura de tapadillo. Hay una prueba para eso.

**La cura siempre se puede comprar** (`curePriceCoins`, 150). Ese camino es lo que hace
aceptable que enfermar duela: el precio son monedas, no días esperando a terminar recados. Las
misiones serán la vía GRATIS para quien no tenga monedas — el mismo principio que las baterías
de las incubadoras, **las monedas compran tiempo, nunca perdón**.

La cura se limpia con `WHERE sick_since IS NOT NULL` y no según la lectura previa: dos curas
compradas a la vez pasarían las dos una comprobación hecha en TypeScript, y la segunda no puede
cobrar por nada.

### Afinidad — lo que una kriatura siente por quien la cuida

Sube **alimentándola** (+5) y sobre todo **llevándola a pelear** (+8): lo que une a alguien con
una kriatura es llevarla, no llenarle el cuenco. Y **baja sola** si la tienes abandonada.

Esa bajada es una decisión de diseño que va contra la regla que gobierna la stamina —la
ausencia nunca quita nada— así que está **confinada a `core/affinity` y a ningún otro sitio**:
nada más en el juego decae con el reloj. Y lleva un **suelo** (`floorPoints`), porque una
kriatura con la que jugaste cien horas no vuelve a ser una desconocida por dos semanas de
vacaciones. La ausencia enfría, no borra.

- **No se almacena el valor, se almacena LO GANADO.** `affinity_points` + `affinity_at`, y el
  presente se deriva al leer — igual que la stamina sale de `last_fed`. Un número que alguien
  tiene que ir bajando necesita una tarea de fondo, y una tarea de fondo es otro reloj que puede
  desincronizarse.
- **Se suma sobre el valor de HOY, nunca sobre lo guardado.** Sumar sobre lo guardado
  resucitaría de golpe todo lo que el tiempo se llevó: una kriatura olvidada un mes volvería a
  tope con una sola comida. `addAffinity` normaliza y después suma, igual que `feed` con el
  ancla.
- **Se lee como una CARA** (`app/affinity-face.tsx`), de gris con la boca recta a verde
  contenta. Un número no dice nada emocional y una barra parece una estadística más. El color
  nunca es la única señal: **la boca cambia de forma** en cada escalón, así que quien no
  distingue el verde del gris sigue viendo una línea recta convertirse en una sonrisa.

#### El nido — una tirada al día

Las kriaturas en **afinidad alta** pueden poner un huevo. La probabilidad sube con cuántas
tengas contentas y **nunca pasa del 20%** (`maxChancePercent`): ese techo es lo que mantiene el
corral como un extra, con la tienda de camino fiable y la mina de afortunado.

- **Una vez al día, guardada en una fecha** (`players.last_nest_check`). Si la tirada ocurriera
  al cargar la página bastaría con recargar hasta que saliera huevo — el mismo agujero que el
  registro de días pagados cierra con su índice único, resuelto igual.
- **La probabilidad SE ENSEÑA.** Un dado escondido no se distingue de estar haciendo algo mal, y
  aquí lo que sube la cifra —cuidar a las kriaturas— es justo lo que el jugador tiene que
  entender.
- **Sin incubadora libre no se tira.** Mejor decir "no cabe" que gastar la tirada del día en un
  huevo que no puede existir. El huevo ocupa slot de incubadora, no plaza de corral.
- La especie se sortea server-side como en cualquier otro huevo, y sigue oculta hasta que
  eclosiona.

### A still image that walks

The creatures will be fixed artwork, so the animation is not of the DRAWING — it is of its
PLACE. Three things make one frame stroll convincingly:

1. a slow drift from one side of the pen to the other,
2. a short bob up and down — the breathing,
3. and the **horizontal flip at each end**, which is what actually sells it. Without it the
   creature looks dragged backwards for half of every round trip.

Each one starts at its own point in the cycle with its own duration, derived from **its id** —
stable across renders, so a creature never jumps somewhere else when the page redraws, and they
do not all move in unison like a chorus.

A **tired** creature stops moving and desaturates: something is wrong with it, readable without
finding a number. Under `prefers-reduced-motion` they walk far slower and stop bobbing — reduce
asks for less movement, and a pen with nothing moving in it stops reading as a place where
animals live.

**Selecting one opens the care card**, docked at the bottom rather than floating over the pen:
a popover would cover exactly what you just tapped, and on a phone the thumb is already in that
half of the screen.

> **Never call a helper that opens its own connection inside a transaction.** `hatchEgg` asked
> `corralWithRoom` for a place from inside `db.transaction`, and PGlite — one process — simply
> hung. Even where it would not, the check would be reading outside the transaction it exists to
> guard. Inside a `tx`, query with that `tx`.

## Match-3 engine

`core/match3` holds the whole turn as pure functions: `createPlayableBoard`, `findRuns`,
`applyGravity`, `resolveMove`, `resolveTurn`. No UI, no storage, no clock, no `Math.random`.

- **The board holds six tile kinds**: the four base elements, `food` and `drakofruta`. More
  kinds means fewer accidental alignments (a random fill makes roughly 96/N^2 of them), which is
  why the kinds are dealt from a WEIGHTED bag rather than evenly: spread flat, six kinds would
  make every alignment rarer and hand out the fruit like gravel. `createBoard` also never places
  a tile that completes a run, and `createPlayableBoard` guarantees a legal move exists.
- **Two resource tiles, and neither is an element.** Matching `food` grants food; matching
  `drakofruta` fills the IN-BATTLE evolution bar. Neither triggers a creature.
- **Drakofruta IS a board tile, and the rarest one** (`combat.tileWeights`, dealt from a bag so
  the elements stay frequent and the fruit stays scarce). This reverses the old rule, and the
  old objection is answered rather than ignored: a tile you can farm must not pay a PERMANENT
  currency, so the fruit pays a power that EXPIRES with the battle. There is no wallet to reach:
  the player has no drakofruta balance at all.
- **The client sends two positions and nothing else** — not the matches it thinks it made,
  not the damage, not the tiles it expects to fall.
- **Free swaps** (`combat.allowFreeSwaps`, on by default): a swap that lines nothing up is a
  legal move. The pieces stay exchanged, nothing clears, and **the turn is spent — the rival
  still answers**. That price is what makes it a choice rather than a free rearrangement: you
  give up an attack to set up a better alignment, or to spoil one. With the flag off the old
  rule applies: the swap is refused and the board comes back untouched.
- Refill tiles come from the server's `random`, so nothing about what falls is predictable
  or steerable from the browser.
- `resolveTurn` triggers every creature whose **species base element** was cleared. A creature
  whose element was not matched does nothing and charges nothing — being on the team is not the
  trigger, the board is. An L or T shape's shared cell is counted once.

### Mana and specials

**A MATCH IS NOT AN ATTACK.** Aligning a creature's element only CHARGES ITS BAR
(`combat.damageOnlyOnSpecial`, on by default). When the bar fills, the attack comes out
carrying the creature's **effects** — its special — and the bar empties. A match that does not
fill a bar deals **zero** damage.

A small attack on every match made the special a rounding error: fights were decided by chip
damage nobody aimed, and holding a bar to land a big hit was strictly worse than clearing
whatever was nearest. Paying only on a full bar makes every gem an investment and makes *which
bar do I feed* the decision of the turn. Switch `damageOnlyOnSpecial` off and the old
per-match attack comes back.

**Longer alignments are worth more mana than their extra gems alone.** `manaGainedFor` pays
`manaPerGem` per gem plus `manaBonusPerExtraGem` for each gem past `minMatchLength`, so a
five-run beats a three-run plus two loose gems — which is what makes building one worth the
move it costs.

#### Tuning: the fight has to MOVE

A team of two on a board of four elements plus food means **most of what you clear charges
nobody**. That is the tuning problem, and three rows answer it:

- **Bars cost 5–14 gems**, not 6–24. A bar nobody ever fills is a creature that spent the whole
  battle doing nothing, and the expensive end of the old range did exactly that.
- **`startingManaPercent` (40) starts every bar part-full**, both sides. Starting empty meant
  the first two or three turns paid nothing at all — the worst possible opening for a game that
  has to earn attention in its first minute.
- **A rival attacks for its FULL species attack**, and its bar costs `rivalManaCostPercent`
  (70%) of the species price. Rivals carry no effects and never evolve, so their special is bare
  damage: at the species price the rival simply never fired, and an opponent that cannot answer
  is scenery, not a fight.
- **`playerMaxHp` is 120.** Health is the knob for LENGTH, the bars are the knob for RHYTHM, and
  confusing the two is how tuning goes wrong: at 100 a battle ended in three turns, at 150 it
  dragged while the rival never fired.

Measured at these numbers: **10 turns, 24 moves, six specials from the player and seven hits
from the rival**, ending 33/120 — level at 47 against 46 halfway through. A special on a
three-run deals ~10; the same special on a four-run deals ~44, so **saving a big run for the
turn the bar completes is the sharpest play in the game**.

Run length multiplies the hit (`damageForMatch`), and damage only lands when the bar fills — so
the sharpest play in the game is **saving a four or five for the turn the bar completes**.

So effects are not a per-match freebie; they are what the bar is for, and they are the reason
two creatures of one element feel different. `chargeMana` fires **at most once per turn** even
if a cascade delivers several bars' worth, and carries the leftover capped at one bar, so a
lucky cascade cannot bank charges for later.

Mana is **battle** state, written only by the server from resolved moves. Storing it as a
number is safe: unlike stamina it does not regenerate with real time, so there is no clock for
a client to lie about.

`play.teamSize` (2) and `play.defaultManaCost` (12) are config. The board carries four base
elements, so a team smaller than four leaves elements that charge nobody — a deliberate tuning
choice, which is why it is a row and not a constant.

#### ONE ELEMENT PER TEAM

Two creatures of the same element are refused (`firstDuplicateElement`). A gem charges EVERY
creature of its element at once, so a pair sharing one element fills both bars off a single
match: double value per gem, and the decision the turn is built around — *which bar do I feed* —
simply gone, because both bars answer to the same gem.

The terminal simulator enforced this from the day it was written; the web battle did not, which
is the same gap the dead-board reshuffle had. Both sides now ask ONE function: the picker greys
out an element already taken and says why, and `startBattle` refuses it regardless, because the
client sends creature ids and a crafted request walks straight past a disabled button.

A white creature is not "the same element as another white one": it charges on nothing, so it is
skipped rather than counted as a duplicate — it is already refused for having no element.

**The RIVAL pair obeys it too** (`pickDistinctElements`), and that half matters more: a lineup is
BUILT by the server rather than chosen, so there is no form to grey out — a rival pair sharing an
element simply charges both bars off one gem and fires twice as often, with nothing on screen to
say why. It is also picked at RANDOM now; taking the first two of the pool meant every battle
faced the same two species.
- A result carries `settled: false` when the cascade cap stopped the loop with runs still on
  the board; the caller must resolve again or reshuffle rather than hand that to the player.

Board size, `minMatchLength` and `maxCascades` are config (`combat`), never constants.

## Battle — two players, one life each

`core/battle` holds the health model. Pure: no clock, no randomness, no storage.

**THE CREATURES HAVE NO HEALTH AND DO NOT DIE.** Your pair attacks the RIVAL PLAYER; the
rival's pair attacks you. A creature is a weapon with an element and a mana bar, never a target
— which is why nothing in `core/battle` reads or writes a creature's hit points, and why
`storedRivalSchema` has no `hp` field to tempt anyone.

Both lives are the same fixed size (`combat.playerMaxHp`), so a lineup changes the damage you
deal, never how much you can take.

`species.baseHp` and `evolutionPath.hpBonus` therefore feed nothing in a battle. They remain
species data for the roster and for whatever later mode wants them.

- Your damage lands **first**: emptying the rival ends the battle before they answer, so
  finishing beats trading.

### The turn: two moves, and a bonus for a big run

A turn is `combat.movesPerTurn` (2) moves. Clear a run of `combat.extraMoveMinRun` (4) or more
and you get **one more move** — granted at most `extraMovesPerTurn` (1) times per turn, however
many big runs you make, because without that cap a cascade chain could hand someone an endless
turn. `movesLeft` and `extraMoveUsed` are **columns on `battles`**, not memory: a turn now
spans several requests, so the server has to remember how many moves are left and whether the
bonus was already handed out.

### The rival is a bot, and it plays YOUR board

When your moves run out, the bot plays — `combat.movesPerTurn` moves on the **same board**,
with the same bonus-move rule, chosen by `chooseBotMove` (`core/match3/bot.ts`). It charges its
own bars from what it clears and **hits you only when one fills**, exactly like your creatures:
nothing in the resolution is a special case for the machine, which is the only reason the fight
can read as fair.

- The gems you leave behind are the gems it gets. A move is no longer only "what do I clear"
  but "what am I handing over".
- Scoring is deliberately **one clear deep, with no cascade lookahead**, and candidates are
  probed with a fixed random so a refill that has not fallen cannot influence the choice. A bot
  that searched deeper would out-plan a human on a board neither can predict, which reads as
  cheating rather than as difficulty. `combat.botSkill` (0.75) is how often it takes its own
  best answer.
- Its moves come back to the browser as `rivalMoves` and are **replayed after yours** — its
  swap, then its cascade — because otherwise the board would simply look different next time
  you saw it.
- `combat.botEnabled` off restores the old behaviour: the lineup just swings for the sum of its
  attacks (`applyRivalStrike`) without touching the board.

#### The fruit on the board: evolving DURING the fight

Drakofruta aligned on the board fills one **shared bar per side** (`battles.fruits` /
`rival_fruits`). Fill it and you pick ONE creature to transform for the rest of the battle: it
hits like an evolved creature (its path's attack bonus, its path's effects, the evolved damage
multiplier) and it LOOKS like one. `combat.fruitsToEvolve` is the threshold.

- **It is temporary and it is not the permanent evolution.** `battle_creatures.evolved_in_battle`
  holds it; the creature row is never touched, and no wallet fruit is spent.
- **La fruta es el combustible; el PERMISO es la piedra.** Una kriatura sin su piedra fusionada no
  aparece entre las opciones y el servidor la rechaza igual — ver *La piedra elemental*.
- **A creature that never locked a branch borrows its species' DEFAULT path** — the fight cannot
  stop to ask which branch to take.
- **The bot plays by the same rule** (`rivalToEvolve`): it banks the fruit IT clears and spends it
  on its hardest hitter. The board is shared, so the fruit you leave is the fruit it gets — which
  is what makes a drakofruta alignment worth taking even when you would rather charge a bar.
- **You choose, the ceremony shows it.** The prompt lists your creatures; the transformation
  takes the screen exactly like the permanent one and reveals the new look.

#### The turn change is ANNOUNCED and the board is LOCKED

Gems that move with no input read as the game glitching, not as an opponent thinking. So the
handover is staged, and none of it is decoration:

1. **"Turno del rival"** over the board (`BANNER_MS`, ~950ms) before a single gem moves.
2. The board **drains of colour** (`.board-locked`) and carries a **🔒 Juega el rival** pill.
   The lock is a thing you can SEE, not just dead input: a player who taps during the rival's
   turn has to learn why nothing happened.
3. The bot's moves replay.
4. **"Tu turno"** hands it back, and the colour returns.

The lineup that is playing is lit and the other dims (`.arena-active`), and the moves left in
your turn are **pips, not a fraction** — how many moves you have should be countable at a
glance, since that is the number every decision hangs on.

#### The battle has to FIT, on a phone, without scrolling

Having to scroll up to see your health turns every move into two gestures, and health is exactly
what you look at after playing. So everything above the board earns its height or loses it:

- **The pips live ON the board** (`.board-moves`, top right), not in the HUD. In the middle of a
  row shared with two life totals they made it wrap on a narrow screen, which pushed the board —
  and the health bars — below the fold. There they cost no height at all and sit where the eye
  already is.
- **The turn NUMBER is gone.** Nothing is decided with it. The pips are the only number in that
  row anybody acts on.
- **"Juega el rival" is said once**, by the lock pill on the board. The HUD used to say it too.
- **No `<h1>` during a battle.** A board with two lineups over it does not need a caption.
- **The field's rule FOLDS** rather than being clipped. Spelled out it took three lines of a
  phone; clipped with an ellipsis there was no way to learn what the field does, which is the one
  thing worth knowing before the first move. The name is always there, the rule opens on a tap,
  and it starts open on turn one.
- Under `max-height: 760px` the gaps, the arena padding and the drag hint shrink or go.
- **The move summary FLOATS** (`.move-log`), over the bottom of the board. As a block in the
  grid it appeared and vanished with every move, shifting the board and the life bars under the
  player's thumb — on a phone that reads as the screen moving while you play. Absolutely
  positioned it costs no height, never eats a gesture, and fades on its own: it is a receipt for
  something the animation already showed. A refusal is kept longer and in red, because that one
  has to be READ rather than confirmed.

#### The bars are paced by the REPLAY, not by the server

One request resolves your move **and** the bot's answer, so the page re-renders with the final
numbers at once. Rendering health straight from those props meant the player watched their life
drop during their OWN turn, with nothing on screen to explain it — the single most confusing
thing the battle did.

So `board.tsx` keeps `shown` health and a frozen copy of every mana bar, and moves them where
the animation says:

- your damage lands when YOUR gems finish clearing,
- each of the bot's hits lands after the cascade that caused it,
- everything settles on the server's numbers when the replay ends.

The snapshot is taken in `submit()`, BEFORE the answer arrives — by the time the replay effect
runs, the props are already the post-turn values, so freezing them there would freeze the
spoiler. `.bar-fill` also transitions its width: a bar that jumps reads as a number changing,
one that slides reads as a blow landing.

**An attack is three beats, never one.** `resolveAttacks` plays them in the only order that
explains itself, for your creatures and the bot's alike:

1. **the bar fills** with the gems that charged it — a bar that fired must be seen full first,
   or the discharge looks like a glitch;
2. **the bar empties and a bolt leaves the creature** (`.shot`, aimed at the life bar it will
   hit, green from your side and red from theirs);
3. **the health drops and the bar flinches** (`.bar-hit`) when the bolt arrives.

The server sends `attacks` per move — `manaAfter`, `manaCost`, `charged` per creature — for
exactly this: without it the browser knows the final mana but not *when* it changed, and the
bars can only snap. Damage that appears without a bolt is arithmetic happening off screen;
this is what makes it an event the player watched.

#### The result is a ROW, not a toast

A battle stops being `active` the instant the last gem clears, so the play screen would flip to
the team picker before the player learned they had won. `battles.dismissed_at` fixes that:
`getBattleToShow` returns the active battle **or** the newest won/lost battle that has not been
acknowledged, and the win screen stays until `dismissBattleAction` writes that column.

- It survives a reload, a closed tab and a dead connection. A toast would not.
- It waits for the replay (`showResult` needs `!replaying && !rivalPlaying`): announcing the win
  while gems are still falling cuts the ending off the move that won.
- Abandoning writes `dismissed_at` itself, so quitting never shows a result screen.
- `heal` restores your health, capped at the fixed maximum. `shield` absorbs incoming damage
  before health does, and expires after its turns whether it was used or not.
- Mana is carried forward per creature between turns.

### The powers — one catalogue, eighteen verbs

A creature's special is its list of EFFECTS (`core/effects/schema.ts`), and every creature in the
seed owns a different one. They are data, resolved by generic primitives in
`core/effects/resolve.ts`, so a new creature is a JSONB row and never a new branch:

| effect | what it does |
| ------ | ------------ |
| `damage` | **PIERCING** damage — see below |
| `damage_by_type` | ordinary damage, the blockable channel |
| `heal` / `shield` | restore life / absorb the next blows |
| `combo_bonus` | a percentage on the blockable damage |
| `drain_mana` / `mana_boost` | empty one or two enemy bars / fill your own |
| `absorb_fruit` | bank drakofruta without aligning it |
| `extra_move` / `steal_move` | one more move for you / one fewer for them |
| `poison` | life lost per MOVE the victim makes, for N turns |
| `block_attack` | that creature's blow is cancelled when it fires |
| `paralyze` | that creature's bar stops filling at all |
| `convert_tiles` / `shuffle_board` | repaint tiles / reroll the grid |
| `lifesteal` | a share of what you dealt comes back as health |
| `cleanse` | frees the caster of block, paralysis and poison |
| `fruit_block` | the victim banks no fruit, so it cannot transform |

Variety does not come from adding verbs, it comes from `effectConditionSchema`: `min_gems`,
`min_combo`, `self_below_percent`, `enemy_below_percent`, `min_fruits`, `turn_at_least`,
`self_evolved`, `enemy_element`. Eighteen effects times eight conditions is the combination
space a large roster needs, and each pair reads as a different creature without a line of code.

#### `damage` PIERCES. `damage_by_type` does not

Every attack in this game already lands on the PLAYER — creatures are not targets — so "direct
damage" said nothing. `damage` therefore earns a rule of its own: **it ignores shields and it
survives `block_attack`**, and it does not spend the shield it walked past either.

- `takeHit(state, incoming, pierce)` subtracts the blockable part from the shield first, then
  takes the pierce straight off health. Both sides have a shield
  (`battles.shield` / `opponent_shield`), so the bot's own `shield` effects finally do something
  and there is something to pierce in both directions.
- A blocked creature still delivers its pierce: `combat.ts` zeroes `basicDamage` and
  `effectDamage` and leaves `pierceDamage` standing. That is what makes a pierce power the
  answer to a turtling opponent instead of one more number.
- `TurnOutcome.totalPierce` is carried separately all the way to the database for the same
  reason: merging the two channels at any point would silently make the needle blockable again.

`damage_by_type` keeps the blockable channel and its `enemy_element` condition — it is the
counter-pick, not the needle.

### Una RAREZA se expresa en la bolsa, nunca en los números

La tentación con una kriatura especial es darle las mejores estadísticas, y eso arruina un
roster: a partir de ahí hay una correcta y dieciséis de relleno, y la temporada tiene que
salir a apagar fuegos que nos encendimos nosotros. Lo raro se dice en **tres sitios, y
ninguno es el ataque**:

1. **el peso en la bolsa del huevo** — `maryx` y `albo` van a 1 contra 4, una eclosión de
   cincuenta y seis;
2. **de qué bolsa sale** — `RARE_SLUGS` la deja fuera del **huevo de bienvenida**. Es la única
   diferencia entre las dos bolsas y es deliberada: el huevo barato existe para que la primera
   eclosión llegue pronto, no para repartir la joya. Una rareza que puede salir en la compra de
   50 monedas no es una rareza, y el jugador que la saca el primer día se queda sin nada que
   perseguir;
3. **un poder que no tiene nadie más** — `fruit_block` es suyo y de nadie, y vale más que
   cualquier cifra porque es la única respuesta del juego a que el rival se transforme.

### Maryx — la kriatura de autor

Es la primera que no es relleno, y la única del seed con **nombres y poderes propios por vía**
(`SpeciesSeed.paths`). El resto deriva la vía de la especie —"<nombre> mayor", el mismo poder más
flojo o más fuerte— que es lo correcto para un roster amplio: transformarse tiene que sentirse
como ser uno mismo, más alto. Una kriatura con carácter quiere lo contrario, y eso no se deriva
de nada.

| forma | nombre | elemento | poder |
| ----- | ------ | -------- | ----- |
| base | **Maryx** | psychic | `fruit_block` 3 turnos + `cleanse` |
| normal | **Maryxel** | psychic | `shield` 14 / 2 turnos |
| superior ✦ | **Maryxia** | astral | `lifesteal` 40 |

**Es un ÓPALO, no nácar**, y la diferencia da la kriatura entera. El nácar es un brillo liso que
recorre la superficie; el ópalo parte la luz en **parches** —una rejilla de esferas de sílice— y
por eso sus alas no son un rosa plano sino paneles que se encienden por separado. El material
traía de serie las dos cosas que hacían falta:

- **el ópalo NEGRO es la variedad rara**, la misma piedra con el fondo oscuro y el fuego diez
  veces más visible, así que `Maryxia` —la vía que solo alcanzan las excelentes— no se inventa
  nada: ya es la versión cara de lo que era;
- **un ópalo se cuartea si se seca** y pierde el fuego para siempre, que es literalmente *si la
  dejas seca, puede enfermar*. No es una metáfora puesta encima: es lo que le pasa a su material.

Y el poder es su carácter hecho regla. Es vanidosa, así que lo primero que hace al llenar la
barra no es golpear: es **apagar a los demás**. No pega —ataque bajo, la defensa más baja del
corral y la barra más cara de su elemento— porque todo su valor está en negar y en ser la única
que lo hace.

## Campos — the battlefield as an opponent

A second mode. `/jugar` offers **Empezar partida** (the ordinary fight) and **Jugar en un
campo**, and a field is ROLLED SERVER-SIDE for the whole battle. The client asks for a MODE and
never for a field: a field you can pick is a field you can farm, so `startBattleSchema` carries
`mode` and nothing else, and which one came up is not knowable until the row exists.

`core/fields` owns it, pure like the rest of `/core`. Ten fields:

| campo | rule |
| ----- | ---- |
| **Remolino** | every tile changes place when the turn ends |
| **Campo minado** | mines count down ONE PER MOVE; at zero they blow the square around them |
| **Volcán** | one element falls three times as often |
| **Sequía** | no drakofruta at all: nobody transforms |
| **Vergel** | triple fruit: a race to transform first |
| **Santuario** / **Páramo** | both sides heal / bleed at the end of every turn |
| **Duelo** | ONE move per turn, but every gem is worth double mana |
| **Resonancia** | the gems past the minimum pay triple: a five-run is enormous |
| **Vendaval** | one random column rolls by one when the turn ends |

### A field is a RULE, not composed data

Creature effects are data because an admin will author hundreds of them. Fields are the
opposite: ten, fixed, each one a sentence. So the VERB lives in code (`core/fields`) and only
the tuning is a table (`FIELD_TUNING`). Composing them the way effects compose would buy
nothing and cost legibility, and a field nobody can restate in one line is a field nobody will
play around.

**`tuneCombat(config, field)` hands back an ordinary `CombatConfig`**, which is why five of the
ten needed no engine code at all: the tile bag, the move budget, `resolveTurn` and the bot all
read that tuned config and never learn a field exists. `playMove` and `startBattle` tune once,
at the top, and everything below them is the normal battle.

- **The field is COPIED INTO THE ROW** (`battles.field`, JSONB, Zod-validated on every read and
  write) for the same reason the mana costs are: retuning a field must not move the rules under
  a fight in progress. `null` means the ordinary mode, and every reader treats it as "the normal
  rules" rather than as a missing value.
- **A mine is a CELL, not a tile.** Gems fall THROUGH it; it stays where it was laid. A fuse
  that travelled with a tile would have to be threaded through gravity, and a mine that moved
  when the board fell could not be read anyway. That is also why it is drawn as its own layer
  over the board rather than on a gem.
- **What a mine takes charges NOBODY.** `settleQuietly` clears the square, lets the board fall
  and swallows whatever chain the refill sets off — no mana, no fruit, no damage. An explosion
  has to be something that happens TO you; paid out as gems it would just be a free special.
- **A blown mine is replaced.** The field stays dangerous for the whole battle instead of being
  disarmed by waiting it out.
- **A stirred board is re-checked, never trusted**: `afterTurn` refuses a shuffle that leaves an
  alignment already made (which would pay somebody for the weather) or one with no legal move (a
  field that can deadlock the game is a bug, not a difficulty), and falls back to a fresh board
  after twelve tries.
- **A field can END the battle.** `applyFieldTick` decides the status when the páramo drains the
  last point, and a double knockout resolves as a win for the same reason your damage lands
  first.
- **Everything it does is ANNOUNCED** — the blast, the stir, the life it gave or took — because
  a board that changes with no explanation reads as a glitch.

### Fields are EDITABLE — everything except the rule

`battle_fields` is a row per field and `/admin/campos` edits it: the name it shows, the sentence
that explains it, its icon, the **artwork behind the board**, whether it comes up and how often.

What is deliberately NOT in that table is the rule. A whirlwind shuffles the board because
`core/fields` says so, and nothing in any row can invent an eleventh field or turn one into
another — the `kind` column is checked against `FIELD_KINDS`, so a row cannot even name a field
that does not exist. That narrowness is what makes the screen safe to hand to whoever is tuning.

- **`is_enabled` is the real lever.** A field that turns out to be unfun is switched off from
  the panel instead of deleted from a source file, and `weight` answers the other complaint: one
  that is merely strong just comes up less. Both without a deploy.
- **The catalogue is read at the START of a battle and never again**, like the mana costs.
  Turning a field off must not move the rules under a fight being played on it.
- **Switching every field off falls back rather than throwing.** An empty catalogue is a panel
  mistake, not a reason to refuse somebody a battle.
- **The presentation is read PER RENDER**, not snapshotted into the battle row. The rules are
  frozen when the fight starts because they must be; a name, a sentence and a background are not
  rules, and an admin who fixes a typo should see it fixed.

#### The rule FLOATS now, and the name lives on the board

The field used to be a banner above the board: it cost height, and with the rule spelled out it
cost three lines of a phone. Now the name sits in a chip in the board's top-left corner with an
**(i)**, and tapping it floats the sentence OVER the board — absolutely positioned, so it pushes
nothing, and `pointer-events: none` so it never eats a drag.

**The background is deliberately faint** (`.board-art`, 30% under a dark veil). At full strength
it ate the gems, and the gems are the game. The veil is an `::after`, which paints after the
children, so the gems carry a `z-index` — without it the artwork buried them.

### Every board change earns a signal — `convert_tiles` did not have one

The server has always computed `convertedCells` and the browser has always thrown them away, so
a creature with `convert_tiles` (Pirox repaints four) changed four gems with **nothing on screen
to say why**. It was reported as "sometimes the tiles change for no reason", and that is exactly
what it was: it had nothing to do with the fields, which is why it happened with no field at all.

The rule this breaks is already written above: a board that changes with no explanation reads as
the game moving pieces behind the player's back. So every way the board can change now has one:

| what changed it | signal |
| --- | --- |
| a cascade | the replay (the gems fall) |
| `convert_tiles` | `.painted` — those cells flash, plus a line in the summary |
| `shuffle_board`, a field stir, a dead board | a banner over the board, before the lock lifts |
| a mine | `.blast` on the cells it took |

The flashes are drawn OVER the settled board rather than replayed as frames, because the change
already happened on the server — what was missing was never the pixels, it was the signal.

> The opening board is now dealt from the WEIGHTED bag like every refill after it. It used to be
> dealt flat, which made the first board a different game from the rest of the battle —
> drakofruta on a sixth of the cells instead of a rare find — and the bag is also what carries a
> field's own weighting.

## Playing — the web battle

`/jugar` picks a team and plays. The battle lives in `battles` + `battle_creatures`, and the
server owns all of it.

- **The client sends four numbers** (from-row, from-col, to-row, to-col) and a battle id. Never
  a board, a mana value, damage, or a timestamp. The input schemas are strict.
- Starting a battle spends **stamina on every creature that fights** and rolls the board, in one
  transaction. A tired creature is refused before anything is written.
- A partial unique index allows **one active battle per player** — otherwise a client could open
  several and farm a single stamina charge.
- Resolving a move writes the board, both players' health, mana and **objective progress** in
  one transaction. Progress is only ever written there, from numbers the server computed.
- `species.mana_cost` is per species and editable in the admin: a cheap bar fires often with a
  small effect, an expensive one takes building but lands hard.
- **A dead board is rebuilt.** `createPlayableBoard` guarantees a legal move when the battle
  starts, but a cascade can refill into a grid where nothing lines up — and from there only free
  swaps remain, nobody charges anything, and the battle cannot progress. `playMove` therefore
  re-checks with `hasValidMove` after the whole turn (yours and the bot's) and rolls a new board
  when it is dead, reporting `reshuffled` so the player is told why the board changed under
  them. The terminal simulator had this from the start; the web battle did not, and a player
  could get stuck.

### Dragging and the replay — why there is no game engine

Drag a gem onto a neighbour (or tap one then the other). While the gesture is under way the gem
follows the finger along one axis and its neighbour slides the other way, so the swap is visible
*before* it is committed; past 45% of a cell the move is sent.

The board **replays** what the server decided. `playMove` returns the swapped board plus one
frame per cascade step — the same `steps` the engine already produced while resolving — and the
client plays them: matched gems are crushed out, then the survivors fall.

**The gems have identity.** The grid is not a list of cells whose picture changes — that is
what made it read as a blink no matter how the animation was tuned. Each gem is an object with
its own id that owns a row and a column, positioned absolutely and moved by a transform
transition, so a survivor KEEPS ITS IDENTITY and travels to its new row. Identity is derived
client-side: gravity is deterministic, so the same survivor mapping the engine used is rebuilt
in the browser to decide which gem went where.

**Each gem falls its real distance.** `fallDistances` recomputes, per column, how many rows the
gem now in each cell dropped: survivors fall by the number of cleared cells beneath them, and the
refills at the top fall by however many that column lost. The CSS duration grows with `--fall`
(170ms + 55ms per row), so a gem crossing the column does not land at the same instant as one
that shuffled a single cell. Animating everything the same token distance is what made the board
read as a blink.

A Phaser or Pixi scene would want to own the board, and the board is owned by a database row.
The replay is cosmetic: it always ends by deferring to `board`, which came from the server.

### The arena

Two lineups facing each other: the **rival's pair on the LEFT**, **yours on the RIGHT**, a
divider between them, and the board below. Reading it as rows — enemies above, allies below —
hides whose creature is whose, which is the one thing this layout must make obvious.

The only health bars belong to the two PLAYERS, at the top. Putting a bar under a creature
would say "kill this one", which is not the game.

The board is **7 columns by 5 rows** (`combat.boardWidth` / `boardHeight`), sized so the whole
fight fits a phone screen without scrolling.

### Dragging commits immediately

Releasing a drag swaps the two gems **on the spot**, before the server answers, and the pair
springs back with the same transition if the move is refused. Waiting for the round trip made
the gem snap home and then reappear elsewhere, which read as broken.

Two guards keep that honest:

- `inFlight` blocks the "adopt the server board" effect while a move is animating. The action
  calls `revalidatePath`, so the settled board arrives mid-animation; without the guard every
  gem is rebuilt from scratch and the move teleports.
- `pendingSwap` remembers the optimistic pair, so a refusal reverses exactly that.
- **Never compute inside a `setGems` updater.** An updater runs when React renders, not when it
  is called. Gravity used to decide which refills were born *inside* an updater and read that
  result straight after the call; on a slow frame React had not run it yet, so the refills were
  never told to fall. They sat hidden above the board and popped in at the end, which read as
  the game swapping pieces behind the player's back. Every change is now computed from
  `gemsRef` and then committed, and the newborns are rendered with `flushSync` and painted for
  one frame before they drop, so their fall has a real starting point.
- **A replay's cleanup only undoes an UNFINISHED replay.** React runs the previous replay
  effect's cleanup when the NEXT move's result lands — in the same commit as the new board
  prop, and before the "adopt the server board" effect. A cleanup that always reset `inFlight`
  let that effect paint the settled board first: the player saw the answer in the cleared
  cells, then watched it vanish and cascade back into the same place. It never happened on a
  page's first move (no previous cleanup yet), so one-move tests cannot see it. The sync effect
  also refuses a successful result whose replay has not started (`unplayed`).
  To check it in a browser, play several moves on one page with a MutationObserver on `.board`:
  before a replay ends, the only gems inserted may be refills born above it (row < 0).

### prefers-reduced-motion: reduced, not absent

Cutting the transitions to 1ms turned every move into a blink and made the board unreadable —
a match-3 has to show which gems fell and where. Under `reduce` the travel is shortened to
~130ms and the bounce dropped, which is what "reduce" actually asks for.

**Headless Chrome reports `prefers-reduced-motion: reduce` by DEFAULT.** Any screenshot or
timing check must emulate `no-preference`, or it silently measures the reduced branch and every
animation looks broken:

```js
await send('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
});
```

If the game looks like it jumps on a real machine, check the OS setting first — on Windows it is
Settings → Accessibility → Visual effects → Animation effects.

### Art: SVG placeholders

`app/gem.tsx` draws each board gem as a bevelled 3D block — four bevel faces around a flat front,
one palette per element, plus a glyph so colour is never the only cue.

**Food is drawn as a loose fruit, with no block.** The four elements are the board's material;
food is a thing lying among them. The silhouette carries the rule — "this one charges nobody" —
so the player never has to remember it. `PALETTES` has no `food` entry for exactly that reason.

The board sits on a dark slate in both themes so the gems pop, and mana bars use `--mana`
rather than the accent: health and mana in the same green read as the same stat.

`app/creature-art.tsx` draws a species that has no uploaded image: the element picks the palette
and crown, and a hash of the NAME picks small stable variations, so two fire creatures still look
different and the same creature always looks the same. As soon as `baseImagePath` exists the real
artwork replaces it.

Both are inline SVG: they scale to any tile size, cost no request, and stay crisp on a phone.

### Drakofruta exists ONLY on the board

There is no drakofruta in the player's pockets — no column, no reward, no counter anywhere. It
is a tile you align, it fills the battle's shared bar, and it is gone when the battle ends.

That is what makes it safe to farm: a tile you can grind must never pay a permanent power, and
this one pays a power that expires. Food and coins are unaffected — food falls off the board,
coins are paid for the win, both inside the transaction that resolved the move.

> Adding a key to a config schema gives it a **default**, so rows written before that key existed
> still parse. Without it, every battle would throw the moment the schema grew.

## Caring and evolving

**`/corral` ES "mis kriaturas".** El listado que vivía en `/kriaturas` ya no existe: enseñaba lo
mismo —elemento, marca ✦, números ajustados por la temporada, stamina y el botón de cuidar— pero
como una tabla, y el corral lo enseña como un sitio donde los bichos están, que es lo que son.

La ruta vieja se queda como **redirección**, no borrada: hay enlaces, marcadores y
`revalidatePath` apuntando ahí, y un 404 por una reorganización nuestra es un problema que le
creamos al jugador.

`/kriaturas/[id]` sigue siendo la ficha: alimenta y muestra en qué se transformaría. Ninguna de
las dos puede evolucionar nada — eso pasa dentro de una batalla.

### Seasons — nerfing and buffing without touching a species

`/admin/temporadas` runs the balance. A season owns ADJUSTMENTS (`season_adjustments`), one per
species, and they are applied on top of the species row wherever its numbers are read:

- **Deltas, never absolute values.** `-3 attack` survives a change to the species' printed
  attack; an absolute `9` would silently undo it.
- **The species row is never rewritten.** Ending a season restores everyone with no migration,
  and the note on each row says why it was touched.
- **Clamped at 1** (`core/balance`): a nerf may make a creature weak, never harmless. Zero attack
  would deal nothing for ever, and a zero-cost bar would fire a special on every match.
- **Copied into the battle at the start.** `battles` and `battle_creatures` take the tuned mana
  cost when the fight begins, so a balance change cannot move the floor under a fight in progress.
- **Shown where the player CHOOSES**, not only where the battle resolves: the team picker and the
  roster print the tuned numbers and say what the season did. A roster showing printed numbers
  while the fight uses tuned ones is a roster that lies. They show the EFFECTIVE adjustment, so
  an excellent creature that shrugged a nerf off simply shows no note.
- **Excellent creatures take the buffs and ignore the nerfs.** Rivals are built from species
  rather than from creatures, so they are never excellent and a nerf always reaches them.

One season is active at a time, enforced by a partial unique index rather than by the caller.

## Brand

`public/brand/logo-full.png` (horizontal wordmark) and `public/brand/logo-mark.png` (the K on its
own) are the web assets; `public/brand/source/` keeps the full-resolution originals. The supplied
files had a solid white background, which would render as a white slab on the dark theme, so the
web copies are flood-filled to transparency from the borders only — white *inside* the artwork is
untouched. `app/icon.png` and `app/apple-icon.png` are generated from the mark.

## Resources

Three separate player-level pools, **never interchangeable**, no conversion rate:

| resource     | what it does                    |
| ------------ | ------------------------------- |
| `food`       | restores stamina. Common.       |
| `coins`      | buys eggs and shop items.       |

Drakofruta is **not** in this table on purpose: it is a board tile, not a balance.

## Stamina model — security-critical

**Stamina is never stored as a number. There is no stamina column and there must never be one.**

`creatures.last_fed` (timestamptz) is the regeneration anchor and the only stamina state:

```
stamina(now) = clamp(floor((now - last_fed) / regenSeconds), 0, maxStamina)
```

- Playing **spends** stamina by pushing `last_fed` **forward** by `cost * regenSeconds`.
- Feeding **restores** stamina by pulling `last_fed` **backward**, clamped so the derived value
  can never exceed `maxStamina`.
- Absence only moves `now` forward, so it can only ever **raise** stamina. Stamina never decays
  from a player being away — it is consumed by playing and regenerates over time.
- `now` is always the **server** clock. **Any client-supplied timestamp is ignored**, not even
  read as a hint. Mutation input schemas are `z.strictObject`, so a smuggled timestamp is a
  validation error, not a silently dropped field.
- Playing requires a minimum stamina level: `play.minStaminaToPlay`, per game, from config.

## Server-side only

**Stamina, evolution, objective progress, egg rolls, daily care and effect resolution are always
computed server-side. The client only renders.** No exceptions, no "optimistic" local
recomputation that the server later trusts.

- All mutations are **server actions** with **Zod validation** on their input.
- **Admin access is a role check in the database** (`users.role = 'admin'`), verified server-side
  on every admin request. A client-side role is never trusted.
- Effects are **data, not code**: eighteen types stored as validated JSONB
  (`core/effects/schema.ts`) and resolved by server-side primitives. See *The powers*.

## Admin panel

Species CRUD at `/admin/species` (list with element + published filters), `/admin/species/new`
and `/admin/species/[id]` (edit, evolution paths, powers, delete). No gameplay lives here.

### Building a kriatura by hand: the powers editor

`app/admin/species/effects-editor.tsx` is where a creature stops being stats and becomes a
character. It writes the species' effects and each PATH's effects, and it is the reason the
eighteen primitives are worth having.

- **The fields each power shows come from `core/effects/catalog.ts`**, a table beside the schema
  holding every effect's bounds, its default target and the condition it cannot live without. A
  form with its own `switch` drifts the day a bound moves, and drifts SILENTLY: it offers a
  number the server then refuses. `tests/effect-catalog.test.ts` holds the two apart by checking
  that every catalogue bound is a bound the schema really has, at both ends.
- **`/core` stays language-free.** The catalogue is numbers and field names; the Spanish words
  live in `app/admin/effect-labels.ts`, shared by the editor and the reference list.
- **It submits ONE hidden field holding JSON**, and the action parses it with the same
  `effectListSchema` the resolver reads with. The editor draws valid rows, but the editor is a
  browser: a hand-written payload gets the validation, not the benefit of the doubt.
- **An empty condition is removed, never sent empty** — `effectConditionSchema` refuses `{}`,
  which is what stops "a condition nobody filled in" from reading as "no condition".
- **A path can be edited in place** (`updatePathAction`), powers included. It has to be: a path a
  creature has already locked in cannot be deleted, so "delete and re-add" was no way to retune a
  transformed form. Its target element stays fixed, like the species' base element, because the
  GRADE of the path is derived from that target.

`/admin/poderes` prints the whole catalogue — every power, its fields and every condition —
generated from the table rather than typed out, because a hand-written list of powers goes stale
the first time one is added and a stale reference is the document someone designs a creature
against.

- `base_element` is **not editable** after creation: evolution paths and every creature's
  attack trigger hang off it. It can be **`sin elemento`**, which creates the four faces and the
  four paths of a white species in the same transaction — visible as empty slots from the first
  save, so an artist can see which ones still have no drawing.

### Creating a species creates BOTH grades

`createSpecies` writes the two paths the design calls for: **normal** at its own element
(+10/+5/+3, the default) and **superior** at the canonical pair (+13/+8/+6). It used to write
ONE, aimed at the canonical element and marked default — which left the species with no ordinary
evolution at all and handed the excellent-only form to every creature, the exact reverse of the
rule.

`createEvolutionPathSchema` accepted only EVOLVED targets, so the panel could not create a normal
path even by hand; only the seed could, by writing the row directly. It takes either grade now,
because both are legitimate and `pathTier` reads which from where the path points.

The editor says so out loud: each path carries a **grade badge** and the sentence of who takes it
("cualquier kriatura" / "solo las que llevan la marca ✦"), the add-form labels the species' own
element as *la evolución normal*, and a species with no normal path gets a red notice — which is
what heals the ones created before this was fixed. Each grade has its own image, bonuses and
powers, because a transformed creature that looks identical is a transformation nobody notices.
- The form **draws the creature as you type**. The generated art is what a species without an
  uploaded image looks like everywhere else, so it is the only way to tell before saving that a
  white species really comes out white.
- The evolved element shown in the form is **read-only and derived**. It is never submitted;
  the server derives it again from the base element to create the default path.
- Uploads go through the `ImageStorage` interface (`lib/storage`). Both adapters name files
  with a server-generated UUID — never the client's filename — and re-check type and size.

### Images: the disk locally, Cloudinary on a server

`lib/storage/index.ts` is the only place that chooses, the same shape as `db/client.ts`, and
the ENVIRONMENT decides: Cloudinary when its three credentials are present, the local disk
otherwise. A laptop needs no account; a hosted deploy has no writable filesystem at all, so up
there the variables are what make uploads possible.

- **No SDK.** The upload is one signed POST and the delete is another, so a dependency would buy
  nothing and carry its own update treadmill. `fetch`, `FormData` and `node:crypto` cover it.
- **What is stored is the `public_id`, not a URL.** A URL in the database freezes today's host,
  today's CDN and today's transformation; an id lets `urlFor` decide all three at render time —
  which is how `f_auto,q_auto` reaches every image ever uploaded without a migration. On a phone
  over mobile data that is the difference between artwork that appears and artwork that loads.
- **The signature is the one thing worth testing** (`tests/cloudinary.test.ts`): sorted params
  joined as `k=v&k=v` with the secret appended, SHA-1, and `file`, `api_key`, `resource_type`
  and `cloud_name` never signed. Get any of it wrong and the API says only "Invalid Signature",
  which does not say which of the four mistakes it was.
- **All three credentials or none.** A cloud name with no secret cannot sign, and an adapter that
  half-configures itself fails inside an upload rather than at the one moment anybody is looking.
- **A failed delete is logged, not thrown.** The caller is deleting a species or replacing a
  drawing; refusing that because a remote file could not be tidied is the wrong trade — an orphan
  costs storage and nothing else.
- The API key is public and lives in `.env.example`. **The secret is not**: it belongs in the
  host's environment variables, never in the repo.

## Identity — a door, not a login

There is still no authentication. `lib/auth` falls back to the seeded account outside
production and refuses everyone inside it, which is right for a laptop and useless on a server:
a deployed game would tell every visitor "no hay jugador".

**`/entrar` is the door.** A button creates a GUEST account (`createGuestPlayer`) and writes the
session cookie. It is not a login and does not pretend to be one — there is no password, the
cookie IS the identity, and anyone who copies it is that guest.

- **A guest gets its OWN player and its own creatures**, never a shared demo account. One active
  battle per player is a unique index, so two people on one account would fight over the same
  row and the second would be refused with nothing on screen to explain it.
- **Its starters are chosen from what is PUBLISHED**, rather than from a list of slugs the admin
  may have changed since: **three species of three different base elements**, already
  evolvable, never the white one. One carries the rare mark, because on a link somebody opens
  once, a mechanic nobody reaches may as well not exist. See *La bienvenida* above for why three
  and why they come unlocked. It also gets a corral, an incubator and **one free stone**.
- **The role is hard-coded to `player`**, not passed in: this function is reachable by anyone who
  opens the site, and an argument that could say `admin` would be an admin account anyone can
  mint.
- **Entering is a CLICK, not a page load.** Setting a cookie needs an action, and that constraint
  turns out to be the right shape: a crawler opening the link mints nothing.
- **`ALLOW_ADMIN_ENTRY=true`** adds a second door that hands out the seeded admin session, so the
  panel can be reached from a phone. It is gated on an environment variable rather than on
  anything the browser sends, and it is off unless set.
- `/jugar` and `/kriaturas` **redirect to the door** when there is no player AND no dev fallback.
  On a laptop they still say "run db:seed", because there it really does mean the database is
  empty.

See `DEPLOY.md` for putting it on a server. Two things bite there and both are documented in it:
the database must be a real Postgres (`DATABASE_URL` is the only difference), and image uploads
fail because the local storage adapter needs a writable disk — `LocalImageStorage` now says so
in Spanish instead of surfacing `EROFS`.

### The layout is NOT a security boundary

A guard in `app/admin/layout.tsx` only decides what is DRAWN. In the App Router a layout and
its page render **in parallel**, so a page hidden by the layout has already run its queries and
its output still ships inside the RSC payload — visually hidden, fully readable in the HTML.

Therefore:

- **every admin page** calls `requireAdminPage()` as its first statement, before any query;
- **every server action** calls `requireAdmin()` itself, because an action is addressable on
  its own and no page guard protects it.

Both read `users.role` from the database.

> Identity is still a placeholder: there is no login. Outside production the panel falls back
> to the seeded admin. In production, no session cookie means no user and the panel refuses
> everyone until real authentication is wired into `lib/auth`.

## Schema rules

- UUID primary keys everywhere. Array position and sequential integers are never identity.
- Foreign keys declared and enforced, with explicit cascade rules.
- All timestamps `timestamptz`, always UTC. `created_at` and `updated_at` on every table.
- Any operation touching two tables (evolving spends fruits *and* flips `is_evolved`; buying an
  egg spends coins *and* inserts the egg) **runs inside a transaction**.
- Config (`game_configs.value`) is JSONB validated by the Zod schema registered for its key:
  `stamina`, `play`, `combat`, `eggs`.
- **Removing a config key needs a migration of its own.** Adding one is covered by its Zod
  default, but the schemas are `strictObject`, so a stored row that still carries a REMOVED key
  throws on read. `0009` strips `drakofrutaPerWin` from the `play` row for exactly that reason.

## Migrations

Migrations from day one via Drizzle Kit. **Never `drizzle-kit push`.**

```
npm run db:generate   # write a new migration from the schema
npm run db:migrate    # apply migrations
npm run db:seed       # sample species, paths, objectives, egg types
npm run db:setup      # migrate + seed, for a database that has neither
```

## Commands

```
npm run dev        npm run typecheck        npm test
npm run dev:clean  # wipes .next first
npm run match3     # play a battle in the terminal
```

### The terminal simulator

`npm run match3` plays a real battle against the seeded species, reading the real config
rows — so tuning is done by editing config, not code. It is a development tool, not part of
the game, and it touches nothing but `/core` and the read side of the database.

```
npm run match3                       # play it yourself
npm run match3 -- --seed=7           # replay the exact same battle
npm run match3 -- --auto=40          # watch it play itself
npm run match3 -- --enemy-hp=6       # longer fights, so specials get to fire
```

Moves are typed as `fila,columna dirección`, e.g. `3,4 d` (a=up, b=down, i=left, d=right).

### Reaching the end of a battle on purpose

`scripts/dev-force-result.ts` exists so the win/loss screen can be looked at without grinding a
fight out. Like the simulator it is a development tool, writes nothing the game could not write
itself, and touches only the local database — so **run it with the dev server stopped**, since
PGlite is a single-process file.

```
npx tsx scripts/dev-force-result.ts            # end the active battle as won
npx tsx scripts/dev-force-result.ts lost
npx tsx scripts/dev-force-result.ts hp 12      # short fights: retunes combat.playerMaxHp
npx tsx scripts/dev-force-result.ts fruit 9 3  # drakofruta everywhere, cheap transformation
npx tsx scripts/dev-force-result.ts shield 30 # arm the BOT, to watch a pierce walk through
npx tsx scripts/dev-force-result.ts campo minado  # drop the active battle onto a field
npx tsx scripts/dev-force-result.ts piedra albo water  # the elemental stone the game lacks
npx tsx scripts/dev-force-result.ts nerf brasilla -4 2   # a season adjustment, by slug
npx tsx scripts/dev-force-result.ts clear      # mark every unread result as seen
```

`clear` earns its place: because a result waits on screen until it is acknowledged, a testing
session leaves a QUEUE of win screens for the next person to click through. `npm run db:seed`
puts `playerMaxHp` back to its default.

### The dev server runs on port 3210, not 3000

`localhost` is one origin shared by every project ever run on it, and the origin includes the
port. Another app on `localhost:3000` had registered a **service worker**, which kept
intercepting this app's requests and serving chunks from its own stale cache — the browser then
shows `Application error: a client-side exception has occurred` while the server is perfectly
healthy and a fresh browser profile works fine.

Moving to **3210** sidesteps it completely: a different port is a different origin, so no
service worker from 3000 can reach it. `public/sw.js` is a tombstone that unregisters any ghost
still haunting 3000; it exists only for that, since this project never registers one.

**How to tell this class of problem apart:** if a clean browser profile (incognito) works and
your normal window does not, the server is fine and the browser is holding something stale.

### If PGlite aborts on startup

`Aborted(). Build with -sASSERTIONS` when opening `.pglite` means the data directory was left
in a bad state — almost always because a `next dev` process was force-killed while PGlite was
writing. Deleting the stale `.pglite/postmaster.pid` is worth one try; if it still aborts the
directory is damaged.

The local database is meant to be **reproducible**, so the fix is to rebuild it — but move it
aside rather than delete it, in case something in there was not seeded:

```
mv .pglite .pglite.broken
npm run db:migrate && npm run db:seed
```

Anything created by hand in the admin panel is not in the seed and does not survive this.
**Stop the dev server with Ctrl+C rather than killing the process**, and this does not happen.

#### Headless checks get their OWN database

A browser check needs a server, and a server started from a tool cannot be stopped with Ctrl+C
— killing it is how `.pglite` gets corrupted, and it has happened. So a throwaway server gets
its own DATABASE, never the real data directory:

```
DATABASE_URL=file:./.pglite-check npm run db:migrate && npm run db:seed   # once
DATABASE_URL=file:./.pglite-check npx next dev -p 3211
```

`.pglite-check` is disposable: if a hard kill damages it, delete it and reseed.

**Give it a separate database, NOT a separate `distDir`.** `typedRoutes` writes the route union
into `<distDir>/types/routes.d.ts`, and `tsconfig` feeds those types to `tsc`. A second copy
under `.next-check/types` goes stale the moment a route is added, and then `npm run typecheck`
rejects a `<Link href>` to a page that plainly exists. `NEXT_DIST_DIR` is for running TWO
servers at once — nothing else.

### One dev server at a time

`.next` is shared state. Two `next dev` processes writing to it — or a `next build`
followed by `next dev` without clearing it — leave half-written chunks, and the browser
fails with `Cannot read properties of undefined (reading 'call')` in `layout-router`.

The server is fine; the cache is not. Recipe:

1. Stop **every** dev server (`Ctrl+C`; on Windows check for stray processes with
   `Get-Process node`).
2. `npm run dev:clean`
3. Hard-refresh the browser (`Ctrl+F5`) at http://localhost:3210.

Never run `npm run build` and `npm run dev` against the same `.next` without clearing it
in between.
