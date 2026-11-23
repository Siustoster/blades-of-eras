/**
 * ai.ts — the enemy duelist's brain.
 * A small state machine: hold distance → windup (telegraphed) → strike → recover,
 * plus guard / hurt / stagger reactions. Aggression (0..1, grows as the enemy loses HP)
 * shortens telegraphs, quickens follow-ups and unlocks double strikes — the player must
 * adapt as the duel goes on, which is what makes the systems interact.
 */

import * as THREE from "three";
import { TUNE } from "./config";

export type AIStateName = "idle" | "hold" | "windup" | "strike" | "recover" | "guard" | "hurt" | "stagger";

export interface AIEvents {
  /** windup began: show the intercept marker for `dur` seconds at `point` */
  onWindup(point: THREE.Vector3, dur: number): void;
  /** the strike passes through the intercept point — resolve parry/whiff/hit now */
  onStrike(point: THREE.Vector3): void;
  /** strike finished without contact */
  onWhiff(): void;
}

export interface AIContext {
  enemyPos: THREE.Vector3;
  playerPos: THREE.Vector3;
  dist: number;
  floorY: number; // arenas may raise the floor (samurai platform) — poses are world-space
  enabled: boolean; // false during the teaching intro
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class EnemyAI {
  state: AIStateName = "idle";
  aggression = 0;

  /** desired world-space hand position / blade direction, smoothed by the caller */
  readonly handTarget = new THREE.Vector3();
  readonly dirTarget = new THREE.Vector3(0, 0, 1);
  /** how fast the caller should chase handTarget this frame (1/s) */
  poseRate = 6;
  /** desired enemy body velocity (m/s) */
  moveX = 0;
  moveZ = 0;

  private timer = 0;
  private attackCd = 2.0;
  private strikeDur = 0.16;
  private windupDur = 0.8;
  private readonly intercept = new THREE.Vector3();
  private readonly windupHand = new THREE.Vector3();
  private readonly strikeHand = new THREE.Vector3();
  private readonly strikeDir = new THREE.Vector3();
  private struck = false;
  private comboLeft = 0;
  private strafeDir = 1;
  private strafeTimer = 0;
  private guardWish = 0;

  constructor() {
    this.setState("idle", 0.01);
  }

  get isGuarding(): boolean {
    return this.state === "guard";
  }

  /** called when the player's blade lands a hit */
  hurt(): void {
    if (this.state === "stagger") return; // already open, keep the riposte window
    this.setState("hurt", 0.32);
    // getting hit teaches it to guard — sometimes
    if (Math.random() < 0.5) this.guardWish = 0.9 + Math.random() * 0.7;
  }

  /** called on a successful parry: long vulnerability window */
  stagger(): void {
    this.comboLeft = 0;
    this.setState("stagger", TUNE.STAGGER_TIME);
  }

  reset(): void {
    this.aggression = 0;
    this.attackCd = 2.0;
    this.comboLeft = 0;
    this.guardWish = 0;
    this.moveX = 0;
    this.moveZ = 0;
    this.setState("idle", 0.01);
  }

  private setState(s: AIStateName, dur: number): void {
    this.state = s;
    this.timer = dur;
  }

  update(dt: number, ctx: AIContext, ev: AIEvents): void {
    const { enemyPos, playerPos, dist } = ctx;
    const fy = ctx.floorY;
    const toward = Math.sign(playerPos.z - enemyPos.z) || 1; // enemy faces the player
    this.timer -= dt;

    // shared pose: chest-height ready position, blade on the player's chest
    const holdHand = (out: THREE.Vector3) => out.set(enemyPos.x + 0.12, fy + 1.22, enemyPos.z + toward * 0.55);
    const aimAtPlayer = (out: THREE.Vector3, from: THREE.Vector3) =>
      out.set(playerPos.x - from.x, fy + 1.3 - from.y, playerPos.z - from.z).normalize();

    switch (this.state) {
      case "idle": {
        holdHand(this.handTarget);
        aimAtPlayer(this.dirTarget, this.handTarget);
        this.poseRate = 6;
        this.moveX = 0;
        this.moveZ = 0;
        if (ctx.enabled) this.setState("hold", 0.1);
        break;
      }

      case "hold": {
        this.poseRate = 7;
        holdHand(this.handTarget);
        aimAtPlayer(this.dirTarget, this.handTarget);

        // footwork: keep the ritual distance, drift sideways
        this.strafeTimer -= dt;
        if (this.strafeTimer <= 0) {
          this.strafeTimer = 1.2 + Math.random() * 1.6;
          this.strafeDir = Math.random() < 0.5 ? -1 : 1;
        }
        const err = dist - TUNE.ENEMY_HOLD_DIST;
        // retreating is slower than advancing — the player can corner it against the arena edge
        const pace = err > 0 ? 1 : 0.55;
        this.moveZ = THREE.MathUtils.clamp(err * 1.6, -1, 1) * TUNE.ENEMY_SPEED * pace * toward;
        this.moveX = this.strafeDir * TUNE.ENEMY_SPEED * 0.35;

        // decide the next action
        if (this.guardWish > 0) {
          this.guardWish = 0;
          this.setState("guard", 1.0 + Math.random() * 0.6);
        } else if (ctx.enabled) {
          this.attackCd -= dt;
          const inRange = dist < TUNE.ENEMY_STRIKE_REACH - 0.15 && dist > TUNE.MIN_DIST - 0.3;
          if (this.attackCd <= 0 && inRange) {
            this.beginWindup(ctx, ev, toward);
          }
        }
        break;
      }

      case "windup": {
        this.poseRate = lerp(5, 9, this.aggression);
        this.moveX = 0;
        this.moveZ = 0;
        // blade up and back — the readable telegraph
        this.handTarget.copy(this.windupHand);
        this.dirTarget.set(0, 0.85, -toward * 0.6).normalize();
        if (this.timer <= 0) {
          this.setState("strike", this.strikeDur);
          this.struck = false;
        }
        break;
      }

      case "strike": {
        this.poseRate = 60; // as fast as the smoothing allows — this is the hit
        this.moveZ = toward * TUNE.ENEMY_SPEED * 1.6; // lunge
        const f = 1 - Math.max(this.timer, 0) / this.strikeDur;
        this.handTarget.lerpVectors(this.windupHand, this.strikeHand, Math.min(f * 1.6, 1));
        this.dirTarget.copy(this.strikeDir);
        if (!this.struck && f >= 0.55) {
          this.struck = true;
          ev.onStrike(this.intercept);
        }
        if (this.timer <= 0) {
          if (!this.struck) ev.onStrike(this.intercept);
          if (this.comboLeft > 0) {
            this.comboLeft--;
            this.beginWindup(ctx, ev, toward, 0.5);
          } else {
            ev.onWhiff();
            this.setState("recover", lerp(0.62, 0.4, this.aggression));
          }
        }
        break;
      }

      case "recover": {
        this.poseRate = 5;
        this.moveZ = -toward * TUNE.ENEMY_SPEED * 0.5; // fall back
        holdHand(this.handTarget);
        aimAtPlayer(this.dirTarget, this.handTarget);
        if (this.timer <= 0) {
          this.attackCd = lerp(2.5, 1.25, this.aggression) * (0.8 + Math.random() * 0.5);
          this.setState("hold", 0.1);
        }
        break;
      }

      case "guard": {
        this.poseRate = 10;
        this.moveZ = THREE.MathUtils.clamp((dist - TUNE.ENEMY_HOLD_DIST) * 1.2, -1, 1) * TUNE.ENEMY_SPEED * 0.6 * toward;
        this.moveX = 0;
        // blade held vertically in front of the torso — a wall of steel
        this.handTarget.set(enemyPos.x, fy + 1.05, enemyPos.z + toward * 0.42);
        this.dirTarget.set(0, 1, toward * 0.12).normalize();
        if (this.timer <= 0) {
          this.setState("hold", 0.1);
        }
        break;
      }

      case "hurt": {
        this.poseRate = 8;
        this.moveZ = -toward * TUNE.ENEMY_SPEED * 0.8;
        this.handTarget.set(enemyPos.x - 0.2, fy + 1.0, enemyPos.z + toward * 0.3);
        this.dirTarget.set(0.3, 0.6, toward).normalize();
        if (this.timer <= 0) this.setState("hold", 0.1);
        break;
      }

      case "stagger": {
        this.poseRate = 4;
        this.moveZ = -toward * TUNE.ENEMY_SPEED * 0.3;
        // sword arm hangs low and wide — visibly open for the riposte
        this.handTarget.set(enemyPos.x + 0.45, fy + 0.75, enemyPos.z + toward * 0.25);
        this.dirTarget.set(0.4, -0.5, toward * 0.6).normalize();
        if (this.timer <= 0) {
          this.attackCd = lerp(1.6, 1.0, this.aggression);
          this.setState("hold", 0.1);
        }
        break;
      }
    }
  }

  private beginWindup(ctx: AIContext, ev: AIEvents, toward: number, speedMul = 1): void {
    const { enemyPos, playerPos } = ctx;
    const fy = ctx.floorY;
    this.windupDur = (0.9 - 0.38 * this.aggression) * speedMul;
    this.strikeDur = 0.17 - 0.04 * this.aggression;
    // lock the intercept where the blades will meet — just in front of the player's guard,
    // inside the reach of the player's mouse-driven tip; sidestepping after this point dodges
    this.intercept.set(
      playerPos.x + (Math.random() - 0.5) * 0.3,
      fy + 1.15 + Math.random() * 0.45,
      playerPos.z - toward * 1.3,
    );
    this.windupHand.set(enemyPos.x - 0.45, fy + 1.85, enemyPos.z - toward * 0.15);
    // the sweep passes the blade tip through the intercept point
    this.strikeDir.subVectors(this.intercept, this.windupHand).normalize();
    this.strikeHand.copy(this.intercept).addScaledVector(this.strikeDir, -0.55);
    // aggressive enemies chain a second, faster strike
    if (this.aggression > 0.55 && this.comboLeft === 0 && Math.random() < 0.45) this.comboLeft = 1;
    this.setState("windup", this.windupDur);
    ev.onWindup(this.intercept, this.windupDur);
  }
}
