# Kriaturas

Match-3 creature-collecting game. Next.js (App Router) + TypeScript strict, Drizzle ORM,
PGlite locally, Neon Postgres + Cloudflare Workers in production.

## Folder rules

```
/core      domain logic: elements, stamina, evolution, objectives, eggs, effects, match-3
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
A creature always triggers on its **species base element**, evolved or not
(`triggerElementFor`); evolving only makes it hit harder (`combat.evolvedDamageMultiplier`).
Never map an evolved element back to a base one: poison and rock can both come from plant, so
that mapping is not invertible.

### The four canonical pairs

| base    | default evolution |
| ------- | ----------------- |
| fire    | light             |
| water   | ice               |
| plant   | poison            |
| psychic | astral            |

`CANONICAL_EVOLUTIONS` in `core/elements.ts` is the **default path** created for a new species
and what the admin form prefills. It is not a limit: a species may offer several paths.

## Evolution — branching, gated, permanent

A species owns one or more **evolution paths** (`evolution_paths`): plant → poison *or*
plant → rock. Each path has its own target element, image, stat bonuses and effects.

**The evolved element is never chosen freely.** The choice is a foreign key into the paths the
admin defined for that species, and the server re-checks the path belongs to the creature's
species before writing. An arbitrary element has nowhere to be stored: `target_element` is
constrained to evolved elements only.

Evolution is two permanent steps on **the same creature row** — never a new record, never
reversible:

1. **Choose.** The player locks `creatures.evolution_path_id` (+ `evolution_chosen_at`).
   Written once; the service layer refuses a second write. Config `evolution.allowEarlyPathChoice`
   decides whether this may happen before the requirements are met.
2. **Evolve.** Requires, checked server-side inside **one transaction**:
   - every objective required by that path is **completed** (config `evolution.requireObjectives`),
   - the player holds enough **drakofruta** — `cost(n) = baseFruitCost + n * costIncrementPerEvolution`,
     where `n` is `players.evolutions_performed`, all from the config row, never a constant.

   The transaction spends the fruits, increments `evolutions_performed`, and flips
   `is_evolved` false → true with `evolved_at`.

## Objectives — unlock requirements

`objectives` is an admin catalog: a **metric** (`matches_won`, `element_gems_cleared`,
`days_cared`, …), validated **params**, and a **target value**. `evolution_requirements` links
objectives to a path. No rows means no requirements.

`objective_progress` tracks a counter per creature (`creature_id` set) or per player
(`creature_id` null). **Progress is only ever advanced server-side** from a resolved match or a
completed care day. The client never reports progress and no input schema accepts one.
`completed_at` is written once, so later edits to a target cannot un-complete what was earned.

## Eggs — buy, care daily, hatch

An egg is bought from an `egg_types` row (price = amount + resource) and yields a **random
species** from that type's weighted pool.

**The species is rolled server-side at purchase and stored immediately.** There is nothing to
re-roll and nothing the client can influence; it is simply not exposed by any query until
`status = 'hatched'`.

Care is **one row per (egg, care day)** in `egg_care_log`, with a unique index — so care cannot
be spammed, replayed, or back-filled. `care_date` comes from the server clock plus
`eggs.dayBoundaryUtcOffsetMinutes`, **never from a client timestamp**. Miss more than
`egg_types.max_missed_days` and the egg spoils; reach `care_days_required` and it can hatch into
a creature.

## Match-3 engine

`core/match3` holds the whole turn as pure functions: `createPlayableBoard`, `findRuns`,
`applyGravity`, `resolveMove`, `resolveTurn`. No UI, no storage, no clock, no `Math.random`.

- **The board holds five tile kinds**: the four base elements plus `food`. With N kinds a
  random 8x8 fill produces roughly 96/N^2 free alignments — four kinds gives ~6 unearned
  cascades per fill, five gives ~3.8. `createBoard` avoids them entirely by never placing a
  tile that completes a run, and `createPlayableBoard` also guarantees a legal move exists.
- **Food is a resource, not an element.** Matching it grants food and triggers no creature.
  Drakofruta is deliberately not a board kind: rare enough to protect the economy means it
  would almost never align, and common enough to align would make it farmable.
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

A triggered creature does two things in the same move:

1. **Basic attack, always.** Small, immediate, no effects — there is never a turn where
   nothing happens.
2. **Mana.** The gems cleared charge its bar. When the bar fills, *that same attack* comes out
   carrying the creature's **effects** — its special — and the bar empties.

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
- The rival lineup answers **once per player move**, for the sum of its attacks.
- `heal` restores your health, capped at the fixed maximum. `shield` absorbs incoming damage
  before health does, and expires after its turns whether it was used or not.
- Mana is carried forward per creature between turns.

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

### Where drakofruta comes from

Food falls off the board. **Drakofruta and coins are paid for clearing a wave**
(`play.drakofrutaPerWin`, `play.coinsPerWin`), written inside the same transaction that resolved
the winning move, so a reward cannot be claimed twice. Drakofruta is deliberately not a board
tile: rare enough to protect the evolution economy would mean it almost never aligns, and common
enough to align would make it farmable.

> Adding a key to a config schema gives it a **default**, so rows written before that key existed
> still parse. Without it, every battle would throw the moment the schema grew.

## Caring and evolving

`/kriaturas` lists the roster with stamina derived per render; `/kriaturas/[id]` feeds, shows
objective progress per path, locks a branch and evolves.

Feeding spends food and pulls the anchor backwards in one transaction, consuming only the units
actually needed. Evolving recomputes the fruit cost from the config row rather than trusting the
page that displayed it, and moves player and creature together in one transaction.

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
| `drakofruta` | required to evolve. Rare.       |
| `coins`      | buys eggs and shop items.       |

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
- Effects are **data, not code**: `damage`, `damage_by_type`, `heal`, `shield`, `combo_bonus`,
  stored as validated JSONB (`core/effects/schema.ts`) and resolved by server-side primitives.

## Admin panel

Species CRUD at `/admin/species` (list with element + published filters), `/admin/species/new`
and `/admin/species/[id]` (edit, evolution paths, delete). No gameplay lives here.

- `base_element` is **not editable** after creation: evolution paths and every creature's
  attack trigger hang off it.
- The evolved element shown in the form is **read-only and derived**. It is never submitted;
  the server derives it again from the base element to create the default path.
- Uploads go through the `ImageStorage` interface (`lib/storage`). The local adapter names
  files with a server-generated UUID — never the client's filename — and re-checks type and
  size. R2 later replaces that one file.

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
  `stamina`, `play`, `evolution`, `combat`, `eggs`.

## Migrations

Migrations from day one via Drizzle Kit. **Never `drizzle-kit push`.**

```
npm run db:generate   # write a new migration from the schema
npm run db:migrate    # apply migrations
npm run db:seed       # sample species, paths, objectives, egg types
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
