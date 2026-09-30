'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { flushSync, useFormStatus } from 'react-dom';
import type { StoredBoard, StoredField, StoredRival } from '@/core/schemas/battle';
import { CreatureArt, type ArtElement } from '../creature-art';
import { FIELD_LABELS } from '../field-labels';
import { Gem, type GemKind } from '../gem';
import {
  type BattleActionState,
  abandonBattleAction,
  dismissBattleAction,
  evolveInBattleAction,
  playMoveAction,
} from './actions';

/**
 * The board. It RENDERS and REPLAYS; it never decides.
 *
 * THE GEMS HAVE IDENTITY, and that is the whole point. The grid is not a list
 * of cells whose picture changes — that is exactly what made it blink. Each gem
 * is an object with its own id that OWNS a row and a column, drawn absolutely
 * and moved by a CSS transform transition. When a cascade resolves, survivors
 * keep their identity and slide down to their new rows, so the eye follows the
 * same stone falling instead of watching pictures swap in place.
 *
 * Identity is derived here, not sent: the server sends tile kinds, and gravity
 * is deterministic, so the survivor mapping the engine used can be rebuilt on
 * this side to decide which gem went where. The authority is still the server's
 * board — this is only how the move is shown.
 */

type TeamMember = {
  creatureId: string;
  name: string;
  element: string;
  /** Drawn instead of `element` once it evolved; the trigger never changes. */
  evolvedElement: string | null;
  /** Transformed by the board's fruit, for this battle only. */
  evolvedInBattle: boolean;
  /** The rare mark: it transforms into the SUPERIOR element instead. */
  isExcellent: boolean;
  attack: number;
  mana: number;
  manaCost: number;
};

type Cell = { row: number; col: number };

/** A bolt in flight: where it starts, and how far it has to travel. */
type Shot = {
  key: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  tone: 'mine' | 'foe';
};

/** What one creature's bar did this move, as the server reported it. */
type AttackView = {
  id: string;
  manaAfter: number;
  manaCost: number;
  charged: boolean;
};

type GemState = {
  id: number;
  kind: string;
  row: number;
  col: number;
  /** Rows this gem is travelling right now — drives its duration. */
  fall: number;
  dying: boolean;
};

const adjacent = (a: Cell, b: Cell): boolean =>
  Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

const SWAP_MS = 220;
const CLEAR_MS = 320;
/** How long a bolt takes to reach the life bar it was aimed at. */
const SHOT_MS = 420;
/** Long enough to read "Turno del rival" before the board starts moving on its own. */
const BANNER_MS = 950;
/** A long drop must take longer than a short one, or nothing reads as gravity. */
const fallMs = (rows: number): number => 190 + Math.max(1, rows) * 85;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Two frames, so a newborn gem is painted above the board before it is moved. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

function Bar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="bar">
      <div className="bar-fill" style={{ width: `${pct}%`, background: tone }} />
      <span className="bar-text">
        {value}/{max}
      </span>
    </div>
  );
}

function AbandonButton() {
  const { pending } = useFormStatus();
  return (
    <button className="btn-danger" type="submit" disabled={pending}>
      {pending ? '…' : 'Abandonar'}
    </button>
  );
}

function DismissButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button className="btn-primary" type="submit" disabled={pending}>
      {pending ? 'Saliendo…' : label}
    </button>
  );
}

export function BattleBoard({
  battleId,
  board,
  rivals,
  playerHp,
  playerMaxHp,
  opponentHp,
  opponentMaxHp,
  shield,
  opponentShield,
  field,
  fruits,
  rivalFruits,
  fruitsToEvolve,
  canEvolve,
  turn,
  movesLeft,
  movesPerTurn,
  team,
  finished,
  status,
  rewards,
}: {
  battleId: string;
  board: StoredBoard;
  rivals: StoredRival[];
  playerHp: number;
  playerMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  shield: number;
  /** The bot shields itself too, so damage that vanishes has something to show for it. */
  opponentShield: number;
  /** The field this battle is on, or null in the ordinary mode. */
  field: StoredField | null;
  /** The shared drakofruta bars, and what a transformation costs. */
  fruits: number;
  rivalFruits: number;
  fruitsToEvolve: number;
  canEvolve: boolean;
  turn: number;
  /** Moves left in this turn, and what a turn starts with. */
  movesLeft: number;
  movesPerTurn: number;
  team: TeamMember[];
  finished: boolean;
  status: 'active' | 'won' | 'lost' | 'abandoned';
  /** What clearing the wave paid, shown on the win screen. */
  rewards: { coins: number };
}) {
  const [state, moveAction, isMoving] = useActionState(playMoveAction, {
    ok: false,
  } satisfies BattleActionState);
  const [abandonState, abandon] = useActionState(abandonBattleAction, {
    ok: false,
  } satisfies BattleActionState);
  const [, dismiss] = useActionState(dismissBattleAction, {
    ok: false,
  } satisfies BattleActionState);
  /**
   * The IN-BATTLE transformation: the shared fruit bar, spent on one creature
   * for the rest of this fight. Not the permanent evolution — nothing here
   * touches the creature row or the player's wallet.
   */
  const [evolveState, evolveNow] = useActionState(evolveInBattleAction, {
    ok: false,
  } satisfies BattleActionState);
  const [ceremony, setCeremony] = useState<{ name: string; from: string } | null>(null);

  const nextId = useRef(1);
  const width = board.width;
  const height = board.height;

  const buildGems = (tiles: readonly string[]): GemState[] =>
    tiles.map((kind, index) => ({
      id: nextId.current++,
      kind,
      row: Math.floor(index / width),
      col: index % width,
      fall: 0,
      dying: false,
    }));

  const [gems, setGems] = useState<GemState[]>(() => buildGems(board.tiles));

  /**
   * The gems as last committed, readable synchronously.
   *
   * Every change is COMPUTED from this ref and then committed — never derived
   * inside a setState updater. An updater runs when React renders, not when it
   * is called, so reading its side effects right after the call (which refills
   * were just born) raced React's schedule: on a slow frame the refills were
   * never told to fall. They sat hidden above the board and popped in at the
   * end, which looked exactly like pieces being swapped behind the player's back.
   */
  const gemsRef = useRef<GemState[]>(gems);
  const commit = (next: GemState[]): void => {
    gemsRef.current = next;
    setGems(next);
  };
  const [replaying, setReplaying] = useState(false);
  /** True while the BOT's moves are being replayed on this same board. */
  const [rivalPlaying, setRivalPlaying] = useState(false);
  /**
   * The turn announcement.
   *
   * The bot plays the SAME board, so without a beat that says whose turn it is,
   * gems start moving on their own and it reads as the game glitching rather
   * than as an opponent taking its turn.
   */
  const [banner, setBanner] = useState<{ text: string; tone: 'foe' | 'mine' } | null>(null);
  /**
   * Cells a mine just took. Kept OUT of the replay on purpose: the explosion is
   * not part of the move's cascade — it charged nobody — so it is drawn as a
   * flash over the board the server already settled, not as another frame.
   */
  const [blast, setBlast] = useState<readonly number[]>([]);
  /**
   * Cells a power just repainted. Like the blast, it is drawn OVER the settled
   * board rather than replayed: the change already happened on the server, and
   * what was missing was any sign that it did.
   */
  const [painted, setPainted] = useState<readonly number[]>([]);
  /** The field's rule, folded away until asked for. Open on the first turn. */
  const [fieldOpen, setFieldOpen] = useState(turn === 0);
  /** The move summary, shown floating over the board and then let go. */
  const [flash, setFlash] = useState<{ id: number; text: string; ok: boolean } | null>(null);
  const flashId = useRef(0);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [drag, setDrag] = useState<{ ids: [number, number]; dx: number; dy: number } | null>(null);
  const dragStart = useRef<{ cell: Cell; x: number; y: number; size: number } | null>(null);
  const playedRef = useRef<BattleActionState | null>(null);
  /**
   * True from the moment a move is sent until its replay ends. The action calls
   * revalidatePath, so the server board arrives while the gems are still
   * animating — without this guard the sync below rebuilds every gem from
   * scratch and the move teleports instead of travelling.
   */
  const inFlight = useRef(false);
  /** The optimistic swap, so a refused move can spring back. */
  const pendingSwap = useRef<{ ids: [number, number]; cells: [Cell, Cell] } | null>(null);
  const boardSignature = board.tiles.join(',');

  /**
   * THE BARS FOLLOW THE ANIMATION, NOT THE SERVER.
   *
   * One request resolves your move AND the bot's answer, so the page re-renders
   * with the final numbers at once: health dropped while the player was still
   * looking at their own turn, with nothing on screen to explain it. These
   * shown values stay where they were and take each hit at the moment it is
   * animated, so a blow is something you WATCH land.
   */
  const [shown, setShown] = useState({ playerHp, opponentHp, shield, opponentShield, fruits, rivalFruits });
  const shownRef = useRef(shown);
  const showVitals = (next: {
    playerHp: number;
    opponentHp: number;
    shield: number;
    opponentShield: number;
    fruits: number;
    rivalFruits: number;
  }): void => {
    shownRef.current = next;
    setShown(next);
  };
  /**
   * Mana DRIVEN by the replay: it rises with the gems that charged it and drops
   * to empty at the instant the special fires. Null means "whatever the server
   * says", which is the truth whenever nothing is animating.
   */
  const [shownMana, setShownMana] = useState<Record<string, number> | null>(null);
  const manaRef = useRef<Record<string, number> | null>(null);
  const commitMana = (next: Record<string, number> | null): void => {
    manaRef.current = next;
    setShownMana(next);
  };
  const manaSnapshot = (): Record<string, number> => {
    const snapshot: Record<string, number> = {};
    for (const member of team) snapshot[member.creatureId] = member.mana;
    for (const foe of rivals) snapshot[foe.id] = foe.mana;
    return snapshot;
  };
  const manaOf = (id: string, current: number): number => shownMana?.[id] ?? current;

  /**
   * The bolt that leaves the creature that fired and strikes a life bar.
   *
   * A number going down is a fact; a bolt crossing the screen is an event. It is
   * what ties "my bar filled" to "their health dropped" — otherwise the damage
   * happens somewhere off screen and the player has to infer it.
   */
  const [shots, setShots] = useState<Shot[]>([]);
  const shotKey = useRef(1);
  /** Creatures mid-shot, and the bar taking the hit right now. */
  const [firing, setFiring] = useState<string[]>([]);
  const [hitSide, setHitSide] = useState<'foe' | 'mine' | null>(null);
  const fighterNodes = useRef(new Map<string, HTMLDivElement | null>());
  const foeBarRef = useRef<HTMLDivElement | null>(null);
  const myBarRef = useRef<HTMLDivElement | null>(null);

  const launchShot = (fromId: string, target: 'foe' | 'mine'): void => {
    const source = fighterNodes.current.get(fromId)?.getBoundingClientRect();
    const bar = (target === 'foe' ? foeBarRef : myBarRef).current?.getBoundingClientRect();
    if (!source || !bar) return;

    const key = shotKey.current++;
    const startX = source.left + source.width / 2;
    const startY = source.top + source.height / 2;
    const shot: Shot = {
      key,
      x: startX,
      y: startY,
      dx: bar.left + bar.width / 2 - startX,
      dy: bar.top + bar.height / 2 - startY,
      /** Green leaves your side, red leaves theirs. */
      tone: target === 'foe' ? 'mine' : 'foe',
    };
    setShots((current) => [...current, shot]);
    window.setTimeout(
      () => setShots((current) => current.filter((entry) => entry.key !== key)),
      SHOT_MS + 200,
    );
  };

  /** Adopt the server's numbers whenever nothing is being animated. */
  useEffect(() => {
    if (replaying || inFlight.current) return;
    showVitals({ playerHp, opponentHp, shield, opponentShield, fruits, rivalFruits });
    commitMana(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerHp, opponentHp, shield, opponentShield, fruits, rivalFruits, replaying]);

  /**
   * Adopt the server board whenever it changes and no replay is running: a new
   * battle, a reload, or a move that was refused. During a replay the local
   * gems ARE the truth being animated, so this must not stomp them.
   */
  useEffect(() => {
    /**
     * A successful move whose replay has not started yet: the board prop is
     * already the SETTLED result, and adopting it now would show the answer
     * before the animation that produces it.
     */
    const unplayed =
      state.ok && (state.frames?.length ?? 0) > 0 && playedRef.current !== state;
    if (replaying || inFlight.current || unplayed) return;
    commit(buildGems(board.tiles));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardSignature, replaying]);

  /** A refused move: put the pair back where it came from, visibly. */
  useEffect(() => {
    if (state.ok || !state.message) return;
    if (playedRef.current === state) return;
    playedRef.current = state;

    const swap = pendingSwap.current;
    pendingSwap.current = null;
    inFlight.current = false;
    /** Nothing happened, so the bars go back to what the server says. */
    showVitals({ playerHp, opponentHp, shield, opponentShield, fruits, rivalFruits });
    commitMana(null);
    if (!swap) return;

    const [first, second] = swap.cells;
    commit(
      gemsRef.current.map((gem) =>
        gem.id === swap.ids[0]
          ? { ...gem, row: first.row, col: first.col, fall: 0 }
          : gem.id === swap.ids[1]
            ? { ...gem, row: second.row, col: second.col, fall: 0 }
            : gem,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  useEffect(() => {
    if (!state.ok || !state.frames) return;
    if (playedRef.current === state) return;
    playedRef.current = state;

    const rivalMoves = state.rival ?? [];

    /**
     * A free swap with no answer yet: nothing cleared and the bot did not play,
     * so there is nothing to replay. The pair is already exchanged on screen.
     * Adopt the server board only if it disagrees, so a correct optimistic swap
     * is never cut short by a remount.
     */
    if (state.frames.length === 0 && rivalMoves.length === 0) {
      pendingSwap.current = null;
      inFlight.current = false;
      showVitals({ playerHp, opponentHp, shield, opponentShield, fruits, rivalFruits });
      commitMana(null);
      const shown = gemsRef.current;
      const agrees = board.tiles.every((kind, index) =>
        shown.some(
          (gem) =>
            !gem.dying &&
            gem.row === Math.floor(index / width) &&
            gem.col === index % width &&
            gem.kind === kind,
        ),
      );
      if (!agrees) commit(buildGems(board.tiles));
      return;
    }

    let cancelled = false;
    /** Set when the run ends by itself; a cleanup after that has nothing to undo. */
    let done = false;
    const frames = state.frames;
    const swapped = state.swapped;

    const run = async (): Promise<void> => {
      setReplaying(true);
      setDrag(null);

      /**
       * 1. The swap already happened on release, so this is only the beat that
       *    lets the player see the pair settle before anything is crushed.
       */
      pendingSwap.current = null;
      if (swapped) await sleep(SWAP_MS);

      const played = await playFrames(frames);
      if (!played) return;

      /** YOUR bars charge, fire, and the blow lands — in that order. */
      const landed = await resolveAttacks(
        state.attacks ?? [],
        'foe',
        state.damageToOpponent ?? 0,
        state.healed ?? 0,
      );
      if (!landed) return;

      /**
       * 2. The BOT's turn, on this same board. It is ANNOUNCED and the board is
       *    locked first, then its swap is shown — the two gems trading places —
       *    and only then its cascade. Announcing it is not decoration: gems that
       *    move with no input look like a bug unless the game says who is
       *    moving them.
       */
      if (rivalMoves.length > 0) {
        setRivalPlaying(true);
        setBanner({ text: 'Turno del rival', tone: 'foe' });
        await sleep(BANNER_MS);
        if (cancelled) return;
        setBanner(null);
      }

      for (const rivalMove of rivalMoves) {
        if (cancelled) return;

        const here = gemsRef.current.find(
          (gem) => !gem.dying && gem.row === rivalMove.from.row && gem.col === rivalMove.from.col,
        );
        const there = gemsRef.current.find(
          (gem) => !gem.dying && gem.row === rivalMove.to.row && gem.col === rivalMove.to.col,
        );
        if (here && there) {
          commit(
            gemsRef.current.map((gem) =>
              gem.id === here.id
                ? { ...gem, row: rivalMove.to.row, col: rivalMove.to.col, fall: 0 }
                : gem.id === there.id
                  ? { ...gem, row: rivalMove.from.row, col: rivalMove.from.col, fall: 0 }
                  : gem,
            ),
          );
          await sleep(SWAP_MS + 140);
        }

        const answered = await playFrames(rivalMove.frames);
        if (!answered) return;

        /** And THIS is the hit the player was never shown: it lands here. */
        const took = await resolveAttacks(
          rivalMove.attacks ?? [],
          'mine',
          rivalMove.damageToPlayer,
          0,
        );
        if (!took) return;
      }

      if (cancelled) return;

      /**
       * EL CAMPO MUEVE EL TABLERO, Y SE ANUNCIA ANTES DE QUE PASE.
       *
       * El remolino baraja todo al acabar el turno y el vendaval rota una
       * columna; un tablero muerto se rehace entero. Nada de eso viaja en la
       * animacion --ocurre en el servidor despues de la ultima jugada-- asi que
       * el tablero simplemente aparecia distinto. Un tablero que cambia sin
       * explicacion se lee como un fallo del juego, no como el terreno
       * haciendo lo suyo.
       *
       * Va aqui, entre el rival y tu turno, porque es justo cuando ocurre; y
       * antes de soltar el guard, para que el cartel se vea mientras el tablero
       * todavia es el viejo.
       */
      const stirredBy = state.boardShuffled
        ? '🌀 Un poder revuelve el tablero'
        : state.stirred
          ? state.stirred === 'shuffled'
            ? '🌀 El campo baraja el tablero'
            : '🌬 El vendaval mueve una columna'
          : state.reshuffled
            ? '♻ Sin jugadas posibles: tablero nuevo'
            : null;

      if (stirredBy) {
        setBanner({ text: stirredBy, tone: 'foe' });
        await sleep(BANNER_MS);
        if (cancelled) return;
        setBanner(null);
      }

      /** Handing the board back is announced too, so the lock lifting is legible. */
      if (rivalMoves.length > 0) {
        setRivalPlaying(false);
        setBanner({ text: 'Tu turno', tone: 'mine' });
        await sleep(BANNER_MS);
        if (cancelled) return;
        setBanner(null);
      }

      done = true;
      /** Everything has been shown: settle on the server's numbers. */
      showVitals({ playerHp, opponentHp, shield, opponentShield, fruits, rivalFruits });
      commitMana(null);
      /** Clear the guard first, so the sync effect can adopt the server board. */
      inFlight.current = false;
      setReplaying(false);
    };

    /**
     * The bars and the blow, in an order a player can follow: gems charge the
     * bar, a FULL bar fires a bolt at a life bar, and health drops when the bolt
     * arrives. Returns false if the replay was cancelled underneath it.
     */
    const resolveAttacks = async (
      attacks: readonly AttackView[],
      target: 'foe' | 'mine',
      damage: number,
      healed: number,
    ): Promise<boolean> => {
      if (attacks.length > 0) {
        /** 1. Every bar moves to where the gems left it — full, if it charged. */
        const charged: Record<string, number> = {};
        for (const attack of attacks) {
          charged[attack.id] = attack.charged ? attack.manaCost : attack.manaAfter;
        }
        commitMana({ ...(manaRef.current ?? manaSnapshot()), ...charged });
        await sleep(260);
        if (cancelled) return false;
      }

      const fired = attacks.filter((attack) => attack.charged);
      if (fired.length > 0) {
        /** 2. The full bars discharge, and a bolt leaves each creature. */
        setFiring(fired.map((attack) => attack.id));
        for (const attack of fired) launchShot(attack.id, target);

        const emptied: Record<string, number> = {};
        for (const attack of fired) emptied[attack.id] = attack.manaAfter;
        commitMana({ ...(manaRef.current ?? manaSnapshot()), ...emptied });

        await sleep(SHOT_MS);
        setFiring([]);
        if (cancelled) return false;
      }

      if (damage > 0 || healed > 0) {
        /** 3. The bolt arrives: the bar drops and flinches. */
        showVitals({
          ...shownRef.current,
          playerHp: Math.max(
            0,
            Math.min(
              playerMaxHp,
              shownRef.current.playerHp + healed - (target === 'mine' ? damage : 0),
            ),
          ),
          opponentHp: Math.max(0, shownRef.current.opponentHp - (target === 'foe' ? damage : 0)),
        });
        setHitSide(target);
        await sleep(340);
        setHitSide(null);
        if (cancelled) return false;
      }

      return true;
    };

    /** One side's cascade: crush, then gravity. Returns false if it was cancelled. */
    const playFrames = async (
      frames: { cleared: number[]; tiles: string[] }[],
    ): Promise<boolean> => {
      for (const frame of frames) {
        if (cancelled) return false;

        /** 2. Matched gems are crushed where they stand. */
        const goneCells = new Set(frame.cleared);
        commit(
          gemsRef.current.map((gem) =>
            goneCells.has(gem.row * width + gem.col) ? { ...gem, dying: true } : gem,
          ),
        );
        await sleep(CLEAR_MS);
        if (cancelled) return false;

        /**
         * 3. Gravity, computed HERE — synchronously, from the ref — so the set
         *    of newborns is known for certain before anyone is told to fall.
         *    Survivors keep their identity and travel to the row the engine gave
         *    them; refills are born above the board with their FINAL kind.
         */
        const alive = gemsRef.current.filter((gem) => !gem.dying);
        const moved = new Map(alive.map((gem) => [gem.id, { ...gem }]));
        const born: GemState[] = [];
        let longest = 1;

        for (let col = 0; col < width; col += 1) {
          const column = alive.filter((gem) => gem.col === col).sort((a, b) => b.row - a.row);

          let write = height - 1;
          for (const gem of column) {
            const target = moved.get(gem.id);
            if (target) {
              const distance = write - gem.row;
              target.row = write;
              target.fall = distance;
              longest = Math.max(longest, distance);
            }
            write -= 1;
          }

          /** Whatever is left at the top of the column is new stone. */
          const refills = write + 1;
          for (let row = write; row >= 0; row -= 1) {
            const kind = frame.tiles[row * width + col];
            if (kind === undefined) continue;
            born.push({
              id: nextId.current++,
              kind,
              /** Starts above the board, so its entrance is a real fall. */
              row: row - refills,
              col,
              fall: refills,
              dying: false,
            });
            longest = Math.max(longest, refills);
          }
        }

        /**
         * Render the newborns at their start positions NOW, then let a frame
         * paint them there. Only then are they moved, so the transition has a
         * real "from" — otherwise they would appear already landed.
         */
        flushSync(() => commit([...moved.values(), ...born]));
        await nextFrame();
        if (cancelled) return false;

        const newborn = new Set(born.map((gem) => gem.id));
        commit(
          gemsRef.current.map((gem) =>
            newborn.has(gem.id) ? { ...gem, row: gem.row + gem.fall } : gem,
          ),
        );

        await sleep(fallMs(longest));
      }

      return !cancelled;
    };

    void run();
    return () => {
      cancelled = true;
      /**
       * Only an UNFINISHED replay has anything to undo.
       *
       * React runs this cleanup when the NEXT move's result arrives. A finished
       * run resetting `inFlight` at that instant let the sync effect paint the
       * settled board before the new replay began: the player saw the result,
       * then watched it be taken away and cascade back into the same place.
       * It never happened on the first move of a page — there was no previous
       * cleanup yet — which is why a one-move test could not catch it.
       */
      if (!done) {
        inFlight.current = false;
        setReplaying(false);
        setRivalPlaying(false);
        setBanner(null);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, width, height]);

  const busy = isMoving || replaying || finished;

  /**
   * The result waits for the animation. The winning move's cascade is still
   * running when the server answers, and covering it with a dialog would cut
   * the ending off the very move that won.
   */
  const won = status === 'won';
  const showResult = finished && status !== 'abandoned' && !replaying && !rivalPlaying;
  /** `turn` counts the turns FINISHED, so the one being played is the next. */
  const turnsPlayed = turn + 1;

  /**
   * Sends the move AND swaps the two gems right away.
   *
   * The gem has to carry on from where the finger left it into the new cell —
   * snapping back and then reappearing elsewhere is the thing that looked
   * broken. If the server refuses the move, the pair springs back with the same
   * transition, which is exactly the feedback a match-3 should give.
   */
  const submit = (from: Cell, to: Cell): void => {
    const here = gemAt(from);
    const there = gemAt(to);

    if (here && there) {
      pendingSwap.current = { ids: [here.id, there.id], cells: [from, to] };
      inFlight.current = true;
      /** Captured BEFORE the answer arrives: the server's reply is the spoiler. */
      commitMana(manaSnapshot());
      commit(
        gemsRef.current.map((gem) =>
          gem.id === here.id
            ? { ...gem, row: to.row, col: to.col, fall: 0 }
            : gem.id === there.id
              ? { ...gem, row: from.row, col: from.col, fall: 0 }
              : gem,
        ),
      );
    }

    const data = new FormData();
    data.set('battleId', battleId);
    data.set('fromRow', String(from.row));
    data.set('fromCol', String(from.col));
    data.set('toRow', String(to.row));
    data.set('toCol', String(to.col));
    setSelected(null);
    setDrag(null);
    startTransition(() => {
      moveAction(data);
    });
  };

  const gemAt = (cell: Cell): GemState | undefined =>
    gems.find((gem) => gem.row === cell.row && gem.col === cell.col && !gem.dying);

  const onTap = (cell: Cell): void => {
    if (busy) return;
    if (!selected) {
      setSelected(cell);
      return;
    }
    if (selected.row === cell.row && selected.col === cell.col) {
      setSelected(null);
      return;
    }
    if (adjacent(selected, cell)) submit(selected, cell);
    else setSelected(cell);
  };

  const onPointerDown = (cell: Cell, event: React.PointerEvent<HTMLButtonElement>): void => {
    if (busy) return;
    const size = event.currentTarget.getBoundingClientRect().width || 40;
    dragStart.current = { cell, x: event.clientX, y: event.clientY, size };
    setSelected(cell);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    const start = dragStart.current;
    if (!start || busy) return;

    const rawX = event.clientX - start.x;
    const rawY = event.clientY - start.y;
    if (Math.abs(rawX) < 3 && Math.abs(rawY) < 3) return;

    const horizontal = Math.abs(rawX) > Math.abs(rawY);
    const step = horizontal ? Math.sign(rawX) : Math.sign(rawY);
    const target: Cell = horizontal
      ? { row: start.cell.row, col: start.cell.col + step }
      : { row: start.cell.row + step, col: start.cell.col };

    const inside = target.row >= 0 && target.col >= 0 && target.row < height && target.col < width;
    if (!inside) return;

    const here = gemAt(start.cell);
    const there = gemAt(target);
    if (!here || !there) return;

    const travel = Math.min(Math.abs(horizontal ? rawX : rawY), start.size);
    setDrag({
      ids: [here.id, there.id],
      dx: horizontal ? travel * step : 0,
      dy: horizontal ? 0 : travel * step,
    });

    if (travel > start.size * 0.45) {
      dragStart.current = null;
      submit(start.cell, target);
    }
  };

  const endDrag = (): void => {
    dragStart.current = null;
    setDrag(null);
  };

  /**
   * Two lineups facing each other: the rival's on the LEFT, yours on the RIGHT.
   *
   * THE CREATURES HAVE NO HEALTH BAR because they have no health — the two
   * hearts at the top are the only lives in the battle. A bar under a creature
   * would say "kill this one", which is not the game.
   */
  /**
   * A mine went off: flash the hole it left for a moment. It is deliberately
   * not queued behind the replay — the board the player is looking at is
   * already the settled one, so the flash explains a change that has happened
   * rather than pretending to cause it.
   */
  /**
   * A new result: flash its summary and drop it a few seconds later.
   *
   * Refusals stay longer — "esas casillas no se tocan" is something the player
   * has to read, while "12 de daño" is a receipt for something they just
   * watched happen.
   */
  useEffect(() => {
    if (!state.message) return;
    flashId.current += 1;
    setFlash({ id: flashId.current, text: state.message, ok: state.ok });
    const timer = setTimeout(() => setFlash(null), state.ok ? 3200 : 4500);
    return () => clearTimeout(timer);
  }, [state]);

  /**
   * A power repainted the board: mark those cells for a moment.
   *
   * The server has always sent this and the browser always ignored it, so a
   * creature with `convert_tiles` changed four gems with nothing on screen to
   * say why — which reads as the game shuffling pieces behind the player's
   * back, and was reported as exactly that.
   */
  const converted = state.ok ? state.convertedCells : undefined;
  useEffect(() => {
    if (!converted || converted.length === 0) return;
    setPainted(converted);
    const timer = setTimeout(() => setPainted([]), 1200);
    return () => clearTimeout(timer);
  }, [converted]);

  const detonated = state.ok ? state.detonated : undefined;
  useEffect(() => {
    if (!detonated || detonated.length === 0) return;
    setBlast(detonated);
    const timer = setTimeout(() => setBlast([]), 900);
    return () => clearTimeout(timer);
  }, [detonated]);

  const fieldLabel = field ? FIELD_LABELS[field.kind] : null;

  return (
    <div className="battle">
      <div className="hud">
        <span className="hud-side">
          <span className="hud-heart">❤</span> {shown.opponentHp}/{opponentMaxHp}
          {shown.opponentShield > 0 ? (
            <span className="hud-shield"> 🛡 {shown.opponentShield}</span>
          ) : null}
        </span>
        <span className="hud-side hud-right">
          {shown.playerHp}/{playerMaxHp} <span className="hud-heart">❤</span>
          {shown.shield > 0 ? <span className="hud-shield"> 🛡 {shown.shield}</span> : null}
        </span>
      </div>

      <div className="lifebars">
        <div className={`bar${hitSide === 'foe' ? ' bar-hit' : ''}`} ref={foeBarRef}>
          <div
            className="bar-fill"
            style={{
              width: `${Math.max(0, Math.round((shown.opponentHp / opponentMaxHp) * 100))}%`,
              background: 'var(--danger)',
            }}
          />
        </div>
        <div className={`bar${hitSide === 'mine' ? ' bar-hit' : ''}`} ref={myBarRef}>
          <div
            className="bar-fill bar-fill-right"
            style={{
              width: `${Math.max(0, Math.round((shown.playerHp / playerMaxHp) * 100))}%`,
              background: 'var(--ok)',
            }}
          />
        </div>
      </div>

      {/*
        * The fruit both sides are fighting over. It sits between the health and
        * the board because that is what it is: the board's business, not a stat.
        */}
      <div className="fruitbars">
        <span className="fruit-count">
          {shown.rivalFruits}/{fruitsToEvolve}
        </span>
        <div className="bar bar-fruit">
          <div
            className="bar-fill"
            style={{
              width: `${Math.min(100, Math.round((shown.rivalFruits / fruitsToEvolve) * 100))}%`,
              background: 'var(--danger)',
            }}
          />
        </div>
        <span className="fruit-mark" aria-hidden="true">
          🐉
        </span>
        <div className="bar bar-fruit">
          <div
            className="bar-fill bar-fill-right"
            style={{
              width: `${Math.min(100, Math.round((shown.fruits / fruitsToEvolve) * 100))}%`,
              background: 'var(--fruit)',
            }}
          />
        </div>
        <span className="fruit-count">
          {shown.fruits}/{fruitsToEvolve}
        </span>
      </div>

      <div className="arena">
        {/* The side that is playing right now is lit; the other one dims. */}
        <div className={`arena-team arena-foes${rivalPlaying ? ' arena-active' : ''}`}>
          {rivals.map((foe) => (
            <div
              className={`fighter fighter-foe${firing.includes(foe.id) ? ' fighter-firing' : ''}`}
              key={foe.id}
              ref={(node) => {
                fighterNodes.current.set(foe.id, node);
              }}
            >
              <CreatureArt
                element={foe.element as ArtElement}
                name={foe.name}
                className="fighter-art"
              />
              <span className="fighter-name">{foe.name}</span>
              <span className="fighter-stat">
                <span className={`tag tag-${foe.element}`}>{foe.element}</span> pega {foe.attack}
                {/* A rival has no evolved form to wear, so it says so instead. */}
                {foe.evolvedInBattle ? <span className="fruit-mark">✦</span> : null}
              </span>
              {/* The rival charges a bar too, and only hits when it fills. */}
              <Bar value={manaOf(foe.id, foe.mana)} max={foe.manaCost} tone="var(--mana)" />
            </div>
          ))}
        </div>

        <div className="arena-vs">VS</div>

        <div className={`arena-team arena-mine${!rivalPlaying && !finished ? ' arena-active' : ''}`}>
          {team.map((member) => (
            <div
              className={`fighter${firing.includes(member.creatureId) ? ' fighter-firing' : ''}`}
              key={member.creatureId}
              ref={(node) => {
                fighterNodes.current.set(member.creatureId, node);
              }}
            >
              <CreatureArt
                element={(member.evolvedElement ?? member.element) as ArtElement}
                name={member.name}
                className="fighter-art"
              />
              <span className="fighter-name">
                {member.name}
                {member.isExcellent ? <span className="excellent-mark">✦</span> : null}
              </span>
              <Bar
                value={manaOf(member.creatureId, member.mana)}
                max={member.manaCost}
                tone="var(--mana)"
              />
            </div>
          ))}
        </div>
      </div>

      {canEvolve && !replaying && !rivalPlaying && !finished && !ceremony ? (
        <div className="card evo-choice">
          <strong>✦ Barra de drakofruta llena</strong>
          <span className="small muted">
            Elige a quién transformar. Dura hasta el final de esta partida.
          </span>
          <div className="evo-choice-options">
            {team
              .filter((member) => !member.evolvedInBattle)
              .map((member) => (
                <form
                  action={evolveNow}
                  key={member.creatureId}
                  onSubmit={() =>
                    setCeremony({
                      name: member.name,
                      from: member.evolvedElement ?? member.element,
                    })
                  }
                >
                  <input type="hidden" name="battleId" value={battleId} />
                  <input type="hidden" name="creatureId" value={member.creatureId} />
                  <button className="btn-primary" type="submit">
                    Transformar a {member.name}
                  </button>
                </form>
              ))}
          </div>
        </div>
      ) : null}

      {abandonState.message ? <p className="notice">{abandonState.message}</p> : null}

      {/*
       * WHAT GROUND ARE WE ON — and the rule FOLDS instead of being clipped.
       *
       * Spelled out in full it took three lines of a phone and pushed the board
       * off the screen; clipped with an ellipsis there was no way to learn what
       * the field does, which is the one thing worth knowing before the first
       * move. So the name is always there and the rule opens on a tap: the
       * height is the player's decision, taken when they are not looking at the
       * board anyway. It starts open on turn one, because that is when it
       * matters.
       */}
      {fieldLabel ? (
        <button
          type="button"
          className={`field-tag${fieldOpen ? ' field-tag-open' : ''}`}
          onClick={() => setFieldOpen((open) => !open)}
          aria-expanded={fieldOpen}
        >
          <span className="field-icon" aria-hidden="true">
            {fieldLabel.icon}
          </span>
          <strong>{fieldLabel.name}</strong>
          <span className="field-more" aria-hidden="true">
            {fieldOpen ? '▴' : '¿qué hace? ▾'}
          </span>
          {fieldOpen ? <span className="field-rule">{fieldLabel.rule}</span> : null}
        </button>
      ) : null}

      <div className="board-stage">
        <div
          className={`board${rivalPlaying ? ' board-locked' : ''}`}
          style={
            {
              '--cols': width,
              '--rows': height,
              aspectRatio: `${width} / ${height}`,
            } as React.CSSProperties
          }
          aria-disabled={rivalPlaying}
          onPointerLeave={endDrag}
        >
          {gems.map((gem) => {
            const dragged = drag?.ids[0] === gem.id;
            const partner = drag?.ids[1] === gem.id;
            const nudgeX = dragged ? (drag?.dx ?? 0) : partner ? -(drag?.dx ?? 0) : 0;
            const nudgeY = dragged ? (drag?.dy ?? 0) : partner ? -(drag?.dy ?? 0) : 0;
            const isSelected =
              selected?.row === gem.row && selected?.col === gem.col && !busy && !gem.dying;

            return (
              <button
                key={gem.id}
                type="button"
                className={[
                  'gem-tile',
                  gem.dying ? 'gem-dying' : '',
                  isSelected ? 'gem-selected' : '',
                  dragged || partner ? 'gem-nudged' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={
                  {
                    '--col': gem.col,
                    '--row': gem.row,
                    '--nudge-x': `${nudgeX}px`,
                    '--nudge-y': `${nudgeY}px`,
                    '--move-ms': `${gem.fall > 0 ? fallMs(gem.fall) : SWAP_MS}ms`,
                  } as React.CSSProperties
                }
                onPointerDown={(event) => onPointerDown({ row: gem.row, col: gem.col }, event)}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onClick={() => onTap({ row: gem.row, col: gem.col })}
                disabled={finished || gem.dying}
                aria-label={`fila ${gem.row}, columna ${gem.col}, ${gem.kind}`}
              >
                <Gem kind={gem.kind as GemKind} className="gem" />
              </button>
            );
          })}
          {/*
            * THE MINES SIT ON CELLS, NOT ON TILES.
            *
            * Gems fall through a mine; it stays where it was laid. That is why
            * it is drawn here as its own layer instead of on a gem: a fuse that
            * travelled with a tile would need threading through gravity, and a
            * mine that moved when the board fell would be unreadable anyway.
            */}
          {(field?.bombs ?? []).map((bomb) => (
            <span
              key={`bomb-${bomb.at}`}
              className="mine"
              style={
                {
                  '--col': bomb.at % width,
                  '--row': Math.floor(bomb.at / width),
                } as React.CSSProperties
              }
              aria-label={`mina en la fila ${Math.floor(bomb.at / width)}, columna ${bomb.at % width}: ${bomb.fuse}`}
            >
              {bomb.fuse}
            </span>
          ))}

          {/*
            * LAS JUGADAS QUE TE QUEDAN, encima del tablero y no en la cabecera.
            *
            * Es el unico numero de la cabecera sobre el que se decide algo, y
            * estaba compartiendo fila con las dos vidas: en un movil esa fila
            * se partia en dos y empujaba el tablero fuera de la pantalla. Aqui
            * no ocupa altura, y ademas esta donde se mira.
            *
            * El numero de turno se fue del todo: no se decide nada con el. Y
            * "juega el rival" ya lo dice la pastilla con el candado, asi que
            * decirlo dos veces solo costaba sitio.
            */}
          {rivalPlaying ? null : (
            <span className="board-moves" aria-label={`te quedan ${movesLeft} jugadas`}>
              {Array.from({ length: Math.max(movesPerTurn, movesLeft) }, (_, index) => (
                <span key={index} className={`pip${index < movesLeft ? ' pip-on' : ''}`} />
              ))}
            </span>
          )}

          {/*
            * EL RESUMEN DE LA JUGADA, flotando y sin ocupar sitio.
            *
            * Era un bloque dentro de la rejilla, asi que aparecia y desaparecia
            * empujando el tablero y las vidas — en un movil eso es la pantalla
            * moviendose debajo del dedo entre jugada y jugada. Aqui esta
            * posicionado en absoluto: no empuja nada, no se puede tocar, y se
            * desvanece solo porque ya lo dijo la animacion.
            *
            * La `key` cambia con cada resultado para que la animacion vuelva a
            * empezar aunque el texto sea identico al anterior.
            */}
          {flash ? (
            <p
              key={flash.id}
              className={`move-log${flash.ok ? '' : ' move-log-bad'}`}
              role="status"
            >
              {flash.text}
            </p>
          ) : null}

          {painted.map((cell) => (
            <span
              key={`painted-${cell}`}
              className="painted"
              style={
                {
                  '--col': cell % width,
                  '--row': Math.floor(cell / width),
                } as React.CSSProperties
              }
            />
          ))}

          {blast.map((cell) => (
            <span
              key={`blast-${cell}`}
              className="blast"
              style={
                {
                  '--col': cell % width,
                  '--row': Math.floor(cell / width),
                } as React.CSSProperties
              }
            />
          ))}
        </div>

        {/*
          * The lock is a THING ON THE BOARD, not just dead input: a player who
          * taps during the rival's turn must see why nothing happened.
          */}
        {rivalPlaying ? (
          <div className="board-lock">
            <span className="board-lock-text">🔒 Juega el rival</span>
          </div>
        ) : null}

        {banner ? (
          <p className={`turn-banner turn-banner-${banner.tone}`} role="status">
            {banner.text}
          </p>
        ) : null}
      </div>

      {finished ? null : (
        <>
          <p className="small muted board-hint">
            Arrastra una gema hacia su vecina. También puedes tocar una y luego la otra.
          </p>

          <form action={abandon}>
            <input type="hidden" name="battleId" value={battleId} />
            <AbandonButton />
          </form>
        </>
      )}

      {/*
       * THE RESULT IS ANNOUNCED BEFORE THE SCREEN CHANGES.
       *
       * It waits for the replay to finish — being told you won while gems are
       * still falling robs the move of its ending — and it only leaves when the
       * player closes it, because the server marks the row as acknowledged.
       */}
      {/* The transformation takes the screen, exactly like the permanent one. */}
      {ceremony ? (
        <div className="evo-veil" role="dialog" aria-modal="true" aria-label="Transformación">
          <div className={`evo-stage${evolveState.ok ? ' evo-stage-done' : ''}`}>
            <span className="evo-rays" aria-hidden="true" />
            <span className="evo-burst" aria-hidden="true" />

            <CreatureArt
              element={
                (evolveState.ok
                  ? (evolveState.evolvedInBattle?.element ?? ceremony.from)
                  : ceremony.from) as ArtElement
              }
              name={ceremony.name}
              className="evo-art"
            />

            <p className="evo-title">
              {evolveState.ok
                ? `¡${ceremony.name} es ahora ${evolveState.evolvedInBattle?.element ?? 'otra'}!`
                : `${ceremony.name} está cambiando…`}
            </p>
            <p className="small muted">Solo por esta partida.</p>

            {evolveState.message && !evolveState.ok ? (
              <p className="notice notice-error">{evolveState.message}</p>
            ) : null}

            {evolveState.ok || (evolveState.message && !evolveState.ok) ? (
              <button className="btn-primary" type="button" onClick={() => setCeremony(null)}>
                Seguir
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Bolts in flight, over everything: they cross from a creature to a bar. */}
      {shots.map((shot) => (
        <span
          key={shot.key}
          className={`shot shot-${shot.tone}`}
          style={
            {
              left: `${shot.x}px`,
              top: `${shot.y}px`,
              '--dx': `${shot.dx}px`,
              '--dy': `${shot.dy}px`,
            } as React.CSSProperties
          }
        />
      ))}

      {showResult ? (
        <div className="result-veil" role="dialog" aria-modal="true" aria-label="Resultado">
          <div className="card result-card">
            <p className={`result-title ${won ? 'result-won' : 'result-lost'}`}>
              {won ? '¡GANASTE!' : 'PERDISTE'}
            </p>
            <p className="small muted">
              {won
                ? `Dejaste al rival sin vida en ${turnsPlayed} turno${turnsPlayed === 1 ? '' : 's'}.`
                : `Te quedaste sin vida en ${turnsPlayed} turno${turnsPlayed === 1 ? '' : 's'}.`}
            </p>
            {won && rewards.coins > 0 ? (
              <p className="result-rewards">
                <span>🪙 +{rewards.coins} monedas</span>
              </p>
            ) : null}
            {won ? (
              <p className="small muted">Las monedas compran huevos en la tienda.</p>
            ) : (
              <p className="small muted">Tus kriaturas no se pierden. Prueba con otro equipo.</p>
            )}

            <form action={dismiss}>
              <input type="hidden" name="battleId" value={battleId} />
              <DismissButton label={won ? 'Seguir' : 'Volver a intentarlo'} />
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
