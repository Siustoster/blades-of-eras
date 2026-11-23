/**
 * bridge.ts — tiny store connecting the game loop (src/game/*) to the React HUD (src/pages/Home.tsx).
 * The game pushes immutable snapshots; React reads them with useSyncExternalStore.
 * Actions are attached by the game at boot (bridge.attach) and called from menu buttons.
 */

import type { EraId } from "./config";
import type { DuelStats, EraRecord, FlashEvent } from "./types";

export type Screen = "title" | "playing" | "paused" | "gameover";

export interface HudSnapshot {
  screen: Screen;
  era: EraId;
  hpP: number;
  hpE: number;
  hpMax: number;
  win: boolean;
  stats: DuelStats;
  flash: FlashEvent | null;
  hint: string | null;
  countdown: number; // >0 while the pre-fight countdown runs
  muted: boolean;
  records: Record<EraId, EraRecord>;
  intro: boolean; // teaching phase: enemy only guards
  hurtPulse: number; // increments every time the player takes a hit (drives the red vignette)
}

const blankStats = (): DuelStats => ({ hits: 0, parries: 0, dealt: 0, taken: 0, timeSec: 0 });
const blankRecords = (): Record<EraId, EraRecord> => ({
  musketeer: { wins: 0, losses: 0, bestParries: 0 },
  knight: { wins: 0, losses: 0, bestParries: 0 },
  samurai: { wins: 0, losses: 0, bestParries: 0 },
  neon: { wins: 0, losses: 0, bestParries: 0 },
});

export interface BridgeActions {
  start(era?: EraId): void;
  setEra(era: EraId): void;
  pause(): void;
  resume(): void;
  restart(): void;
  toTitle(): void;
  toggleMute(): void;
}

const initial: HudSnapshot = {
  screen: "title",
  era: "musketeer",
  hpP: 100,
  hpE: 100,
  hpMax: 100,
  win: false,
  stats: blankStats(),
  flash: null,
  hint: null,
  countdown: 0,
  muted: false,
  records: blankRecords(),
  intro: false,
  hurtPulse: 0,
};

let snapshot = initial;
const listeners = new Set<() => void>();
let actions: BridgeActions | null = null;

export const bridge = {
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  getSnapshot(): HudSnapshot {
    return snapshot;
  },
  set(patch: Partial<HudSnapshot>): void {
    snapshot = { ...snapshot, ...patch };
    for (const fn of listeners) fn();
  },
  attach(a: BridgeActions): void {
    actions = a;
  },
  detach(): void {
    actions = null;
  },
  /** called from React buttons; no-op before the game boots */
  act(): BridgeActions | null {
    return actions;
  },
  blankStats,
  blankRecords,
};
