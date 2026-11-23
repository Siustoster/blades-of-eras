/**
 * boot.ts — mounts the fencing duel onto the canvas and keeps the contract with the
 * React shell (src/pages/Home.tsx) and the self-check (scripts/verify-game.mjs):
 *
 *   startGame(canvas)  mounts renderer + loop onto an existing <canvas>
 *   stopGame()         tears everything down (loop, renderer, listeners, probe)
 * Calling startGame twice is safe: the previous session is stopped first, so React
 * StrictMode's double mount in dev never leaves two renderers alive.
 */

import { BladeDuelGame } from "./game";

declare global {
  interface Window {
    /** Player-coordinate probe — scripts/verify-game.mjs asserts direction mapping through it. */
    __gameProbe?: () => { x: number; y: number; z: number };
    /** Readiness signal — the self-check waits for it before screenshotting/asserting. */
    __GAME_READY__?: boolean;
    /** Test/debug handle to the live game instance. */
    __bladeDuel?: BladeDuelGame;
  }
}

let session: BladeDuelGame | null = null;

export function startGame(canvas: HTMLCanvasElement): void {
  stopGame();
  const game = new BladeDuelGame(canvas);
  session = game;
  window.__bladeDuel = game;
  // self-check probe: reports the fencer's feet; W steps toward the enemy (z decreases), D sidesteps right (x increases)
  window.__gameProbe = () => {
    const p = game.probe();
    return { x: p.x, y: p.y, z: p.z };
  };
}

export function stopGame(): void {
  session?.dispose();
  session = null;
  window.__bladeDuel = undefined;
  delete window.__gameProbe;
  window.__GAME_READY__ = false;
}
