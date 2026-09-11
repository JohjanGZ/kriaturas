'use client';

import { startTransition, useActionState, useEffect, useRef, useState } from 'react';
import { flushSync, useFormStatus } from 'react-dom';
import type { StoredBoard, StoredRival } from '@/core/schemas/battle';
import { CreatureArt, type ArtElement } from '../creature-art';
import { Gem, type GemKind } from '../gem';
import { type BattleActionState, abandonBattleAction, playMoveAction } from './actions';

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
  attack: number;
  mana: number;
  manaCost: number;
  isEvolved: boolean;
};

type Cell = { row: number; col: number };

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

export function BattleBoard({
  battleId,
  board,
  rivals,
  playerHp,
  playerMaxHp,
  opponentHp,
  opponentMaxHp,
  shield,
  turn,
  team,
  finished,
}: {
  battleId: string;
  board: StoredBoard;
  rivals: StoredRival[];
  playerHp: number;
  playerMaxHp: number;
  opponentHp: number;
  opponentMaxHp: number;
  shield: number;
  turn: number;
  team: TeamMember[];
  finished: boolean;
}) {
  const [state, moveAction, isMoving] = useActionState(playMoveAction, {
    ok: false,
  } satisfies BattleActionState);
  const [abandonState, abandon] = useActionState(abandonBattleAction, {
    ok: false,
  } satisfies BattleActionState);

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

    /**
     * A free swap: nothing cleared, so there is nothing to replay. The pair is
     * already exchanged on screen. Adopt the server board only if it disagrees,
     * so a correct optimistic swap is never cut short by a remount.
     */
    if (state.frames.length === 0) {
      pendingSwap.current = null;
      inFlight.current = false;
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

      for (const frame of frames) {
        if (cancelled) return;

        /** 2. Matched gems are crushed where they stand. */
        const goneCells = new Set(frame.cleared);
        commit(
          gemsRef.current.map((gem) =>
            goneCells.has(gem.row * width + gem.col) ? { ...gem, dying: true } : gem,
          ),
        );
        await sleep(CLEAR_MS);
        if (cancelled) return;

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
        if (cancelled) return;

        const newborn = new Set(born.map((gem) => gem.id));
        commit(
          gemsRef.current.map((gem) =>
            newborn.has(gem.id) ? { ...gem, row: gem.row + gem.fall } : gem,
          ),
        );

        await sleep(fallMs(longest));
      }

      if (cancelled) return;
      done = true;
      /** Clear the guard first, so the sync effect can adopt the server board. */
      inFlight.current = false;
      setReplaying(false);
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
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, width, height]);

  const busy = isMoving || replaying || finished;

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
  return (
    <div className="battle">
      <div className="hud">
        <span className="hud-side">
          <span className="hud-heart">❤</span> {opponentHp}/{opponentMaxHp}
        </span>
        <span className="hud-turn">turno {turn}</span>
        <span className="hud-side hud-right">
          {playerHp}/{playerMaxHp} <span className="hud-heart">❤</span>
          {shield > 0 ? <span className="hud-shield"> 🛡 {shield}</span> : null}
        </span>
      </div>

      <div className="lifebars">
        <div className="bar">
          <div
            className="bar-fill"
            style={{
              width: `${Math.max(0, Math.round((opponentHp / opponentMaxHp) * 100))}%`,
              background: 'var(--danger)',
            }}
          />
        </div>
        <div className="bar">
          <div
            className="bar-fill bar-fill-right"
            style={{
              width: `${Math.max(0, Math.round((playerHp / playerMaxHp) * 100))}%`,
              background: 'var(--ok)',
            }}
          />
        </div>
      </div>

      <div className="arena">
        <div className="arena-team arena-foes">
          {rivals.map((foe) => (
            <div className="fighter fighter-foe" key={foe.id}>
              <CreatureArt
                element={foe.element as ArtElement}
                name={foe.name}
                className="fighter-art"
              />
              <span className="fighter-name">{foe.name}</span>
              <span className="fighter-stat">
                <span className={`tag tag-${foe.element}`}>{foe.element}</span> pega {foe.attack}
              </span>
            </div>
          ))}
        </div>

        <div className="arena-vs">VS</div>

        <div className="arena-team arena-mine">
          {team.map((member) => (
            <div className="fighter" key={member.creatureId}>
              <CreatureArt
                element={member.element as ArtElement}
                name={member.name}
                className="fighter-art"
              />
              <span className="fighter-name">{member.name}</span>
              <Bar value={member.mana} max={member.manaCost} tone="var(--mana)" />
            </div>
          ))}
        </div>
      </div>

      {state.message ? (
        <p className={`notice ${state.ok ? 'notice-ok' : 'notice-error'}`}>{state.message}</p>
      ) : null}
      {abandonState.message ? <p className="notice">{abandonState.message}</p> : null}

      <div
        className="board"
        style={
          {
            '--cols': width,
            '--rows': height,
            aspectRatio: `${width} / ${height}`,
          } as React.CSSProperties
        }
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
      </div>

      <p className="small muted board-hint">
        Arrastra una gema hacia su vecina. También puedes tocar una y luego la otra.
      </p>

      <form action={abandon}>
        <input type="hidden" name="battleId" value={battleId} />
        <AbandonButton />
      </form>
    </div>
  );
}
