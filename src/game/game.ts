/**
 * game.ts — the duel itself: mouse-driven sword, footwork, AI opponent, combat resolution.
 *
 * Controls
 *   mouse            — the blade tip follows your cursor (a plane in front of the fencer)
 *   fast mouse swipe — slash; damage scales with tip speed
 *   LMB              — thrust (lunge)
 *   RMB (hold)       — heavy guard: slower blade, much wider parry window
 *   W/S              — close / open the distance, A/D — circle
 *   Esc / P          — pause, M — mute, Space / Enter — start & restart
 */

import * as THREE from "three";
import { GameLoop } from "./engine";
import { Input } from "./input";
import { GameStateMachine } from "./state";
import { AudioSystem } from "./audio";
import { Duelist } from "./rig";
import { buildArena, type ArenaHandle } from "./arena";
import { Sparks, Trail } from "./fx";
import { EnemyAI, type AIEvents } from "./ai";
import { bridge } from "./bridge";
import { storage } from "./storage";
import { ERAS, TUNE, type EraId } from "./config";
import type { DuelStats, EraRecord, FlashKind } from "./types";

const RECORDS_KEY = "bladeDuel.records.v2";
const ERA_KEY = "bladeDuel.era.v1";

const PLAYER_PALETTE = { body: 0xd8dce4, trim: 0x8898b0, head: 0xd8b49a, dark: 0x2a2f3a };
const ENEMY_PALETTE = { body: 0x3a3238, trim: 0xd8443c, head: 0xc8a088, dark: 0x1c1a20 };

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const SPARK_STEEL = new THREE.Color(0xffd890);
const SPARK_HIT = new THREE.Color(0xff5040);
const FLASH_TEXT: Record<FlashKind, string> = {
  parry: "ПАРИРОВАНО!",
  hit: "ПОПАДАНИЕ!",
  riposte: "РИПОСТ!",
  clang: "ЗАЩИТА",
  hurt: "",
  win: "ПОБЕДА",
  lose: "ПОРАЖЕНИЕ",
};

/** distance from point to segment, all preallocated scalars */
function distPointSeg(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 1e-9 ? (apx * abx + apy * aby + apz * abz) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + abx * t - px, cy = ay + aby * t - py, cz = az + abz * t - pz;
  return Math.sqrt(cx * cx + cy * cy + cz * cz);
}

export class BladeDuelGame implements AIEvents {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private loop: GameLoop;
  private input: Input;
  private audio = new AudioSystem();
  private sm = new GameStateMachine();
  private ai = new EnemyAI();

  private era: EraId;
  private arena: ArenaHandle | null = null;
  private player: Duelist | null = null;
  private enemy: Duelist | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private sparks = new Sparks(160);
  private trailP = new Trail(0xcfe0ff);
  private trailE = new Trail(0xff8060);
  private marker: THREE.Mesh;
  private markerT = 0;

  // positions (feet)
  private playerPos = new THREE.Vector3(0, 0, 1.7);
  private enemyPos = new THREE.Vector3(0, 0, -1.7);
  private floorY = 0;

  // player blade state
  private mouseNdc = new THREE.Vector2(0, 0.1);
  private raycaster = new THREE.Raycaster();
  private bladePlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private tip = new THREE.Vector3();
  private prevTip = new THREE.Vector3();
  private tipSpeed = 0;
  private bladeDir = new THREE.Vector3(0, 0, -1);
  private thrustT = 0;
  private guarding = false;
  private hitCooldown = 0;
  private whooshArmed = true;

  // enemy smoothed pose
  private enemyHand = new THREE.Vector3();
  private enemyDir = new THREE.Vector3(0, 0, 1);

  // duel state
  private hpP: number = TUNE.HP;
  private hpE: number = TUNE.ENEMY_HP;
  private countdown = 0;
  private countdownTick = 4;
  private introT = 0;
  private duelTime = 0;
  private stats: DuelStats = { hits: 0, parries: 0, dealt: 0, taken: 0, timeSec: 0 };
  private records: Record<EraId, EraRecord>;
  private flashId = 0;
  private hitstop = 0;
  private shake = 0;
  private walkAcc = 0;
  private titleOrbit = 0;
  private lowFpsTime = 0;
  private degraded = false;
  private tGlobal = 0;

  private unsub: Array<() => void> = [];

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.05, 120);
    this.scene.add(this.sparks.points, this.trailP.mesh, this.trailE.mesh);

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.11, 12, 10),
      new THREE.MeshBasicMaterial({ color: 0xff4030, transparent: true, opacity: 1, depthWrite: false }),
    );
    this.marker.visible = false;
    this.scene.add(this.marker);

    this.records = storage.get<Record<EraId, EraRecord>>(RECORDS_KEY, bridge.blankRecords());
    this.era = storage.get<EraId>(ERA_KEY, "musketeer");

    this.input = new Input(canvas);
    this.bindPointer();
    this.buildWorld();

    this.loop = new GameLoop({
      update: (dt) => this.update(dt),
      render: () => this.render(),
    });
    this.loop.start();

    bridge.attach({
      start: (era) => this.start(era),
      setEra: (era) => this.setEra(era),
      pause: () => this.pause(),
      resume: () => this.resume(),
      restart: () => this.restart(),
      toTitle: () => this.toTitle(),
      toggleMute: () => this.toggleMute(),
    });
    this.pushHud();
    window.addEventListener("resize", this.onResize);
  }

  /* ------------------------------ world setup ------------------------------ */

  private buildWorld(): void {
    const era = ERAS[this.era];

    // lights
    if (!this.hemi) {
      this.hemi = new THREE.HemisphereLight(era.hemiSky, era.hemiGround, 0.9);
      this.scene.add(this.hemi);
      this.sun = new THREE.DirectionalLight(era.sunColor, era.sunIntensity);
      this.sun.position.set(6, 10, 4);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1024, 1024);
      const c = this.sun.shadow.camera;
      c.left = -9; c.right = 9; c.top = 9; c.bottom = -9; c.near = 1; c.far = 30;
      this.scene.add(this.sun);
    } else {
      this.hemi.color.set(era.hemiSky);
      this.hemi.groundColor.set(era.hemiGround);
      this.sun!.color.set(era.sunColor);
      this.sun!.intensity = era.sunIntensity;
    }
    this.scene.background = new THREE.Color(era.sky);
    this.scene.fog = new THREE.Fog(era.fogColor, era.fogNear, era.fogFar);

    // arena
    this.arena?.dispose();
    this.arena = buildArena(era, 220);
    this.scene.add(this.arena.group);
    this.floorY = this.arena.floorY;

    // duelists
    this.player?.dispose();
    this.enemy?.dispose();
    this.player = new Duelist(era, PLAYER_PALETTE, -1); // faces -z
    this.enemy = new Duelist(era, ENEMY_PALETTE, 1); // faces +z
    this.player.group.position.set(this.playerPos.x, this.floorY, this.playerPos.z);
    this.enemy.group.position.set(this.enemyPos.x, this.floorY, this.enemyPos.z);
    this.scene.add(this.player.group, this.enemy.group);

    // trails pick up the blade's character
    this.trailP.setColor(era.blade.kind === "energy" ? era.accent : 0xcfe0ff);
    this.trailE.setColor(era.blade.kind === "energy" ? 0xff40c0 : 0xff8060);

    // reset blade state to a relaxed en-garde
    this.resetBlade();
    this.resetEnemyPose();
  }

  private resetBlade(): void {
    const S = this.shoulderWorld(_v1);
    this.tip.set(S.x, S.y - 0.35, S.z - 1.1);
    this.prevTip.copy(this.tip);
    this.bladeDir.set(0.05, -0.25, -1).normalize();
    this.thrustT = 0;
    this.guarding = false;
    this.hitCooldown = 0;
    this.posePlayer(1); // snap
  }

  private resetEnemyPose(): void {
    this.enemyHand.set(this.enemyPos.x + 0.12, 1.22, this.enemyPos.z + 0.55);
    this.enemyDir.set(0, 0.1, 1).normalize();
    this.enemy?.setBlade(this.enemyHand, this.enemyDir);
  }

  private shoulderWorld(out: THREE.Vector3): THREE.Vector3 {
    // right shoulder of the player (local -0.26,1.42,0 rotated PI around Y)
    return out.set(this.playerPos.x + 0.26, this.floorY + 1.42, this.playerPos.z);
  }

  /* ------------------------------ pointer ------------------------------ */

  private bindPointer(): void {
    const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      window.addEventListener(type, fn as EventListener, opts);
      this.unsub.push(() => window.removeEventListener(type, fn as EventListener, opts));
    };
    on("mousemove", (e) => {
      this.mouseNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    });
    on("mousedown", (e) => {
      if (!this.sm.is("playing")) return;
      if (e.button === 0 && this.countdown <= 0) this.thrustT = TUNE.THRUST_TIME;
      if (e.button === 2) this.guarding = true;
    });
    on("mouseup", (e) => {
      if (e.button === 2) this.guarding = false;
    });
    on("contextmenu", (e) => {
      if (e.target === this.canvas) e.preventDefault();
    });
    on("blur", () => {
      this.guarding = false;
    });
    // touch: drag steers the blade, a quick tap thrusts
    let touchStart = 0;
    let touchMoved = false;
    on("touchstart", (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      touchStart = performance.now();
      touchMoved = false;
      this.mouseNdc.set((t.clientX / window.innerWidth) * 2 - 1, -(t.clientY / window.innerHeight) * 2 + 1);
    }, { passive: true });
    on("touchmove", (e) => {
      const t = e.changedTouches[0];
      if (!t) return;
      touchMoved = true;
      this.mouseNdc.set((t.clientX / window.innerWidth) * 2 - 1, -(t.clientY / window.innerHeight) * 2 + 1);
    }, { passive: true });
    on("touchend", () => {
      if (!touchMoved && performance.now() - touchStart < 220 && this.sm.is("playing") && this.countdown <= 0) {
        this.thrustT = TUNE.THRUST_TIME;
      }
    }, { passive: true });
  }

  /* ------------------------------ flow ------------------------------ */

  private setEra(era: EraId): void {
    if (!this.sm.is("title")) return;
    if (era === this.era) return;
    this.era = era;
    storage.set(ERA_KEY, era);
    this.buildWorld();
    this.audio.sfx("ui");
    this.pushHud();
  }

  private start(era?: EraId): void {
    if (era && era !== this.era) {
      this.era = era;
      storage.set(ERA_KEY, era);
    }
    this.buildWorld();
    this.hpP = TUNE.HP;
    this.hpE = TUNE.ENEMY_HP;
    this.ai.reset();
    this.stats = { hits: 0, parries: 0, dealt: 0, taken: 0, timeSec: 0 };
    this.playerPos.set(0, 0, 1.7);
    this.enemyPos.set(0, 0, -1.7);
    this.duelTime = 0;
    this.countdown = 3 * TUNE.COUNTDOWN_STEP;
    this.countdownTick = 4;
    this.introT = TUNE.INTRO_TIME;
    this.marker.visible = false;
    this.sm.transition("playing"); // legal from title / gameover / paused
    bridge.set({ win: false });
    this.audio.startMusic(ERAS[this.era].music);
    this.audio.sfx("count");
    this.pushHud();
  }

  private restart(): void {
    this.start();
  }

  private pause(): void {
    if (!this.sm.is("playing")) return;
    this.sm.transition("paused");
    this.audio.setTension(0);
    this.pushHud();
  }

  private resume(): void {
    if (!this.sm.is("paused")) return;
    this.sm.transition("playing");
    this.pushHud();
  }

  private toTitle(): void {
    if (this.sm.is("playing")) this.sm.transition("title");
    else if (this.sm.is("paused") || this.sm.is("gameover")) this.sm.transition("title");
    this.audio.stopMusic();
    this.audio.setTension(0);
    this.marker.visible = false;
    this.pushHud();
  }

  private toggleMute(): void {
    this.audio.toggleMute();
    this.pushHud();
  }

  private gameOver(win: boolean): void {
    this.sm.transition("gameover");
    this.stats.timeSec = Math.round(this.duelTime);
    const rec = this.records[this.era];
    if (win) {
      rec.wins++;
      rec.bestParries = Math.max(rec.bestParries, this.stats.parries);
    } else {
      rec.losses++;
    }
    storage.set(RECORDS_KEY, this.records);
    this.audio.setTension(0);
    this.audio.sfx(win ? "win" : "lose");
    this.flash(win ? "win" : "lose");
    bridge.set({ hint: null, win });
    this.pushHud();
  }

  private flash(kind: FlashKind): void {
    this.flashId++;
    bridge.set({ flash: { id: this.flashId, text: FLASH_TEXT[kind], kind } });
  }

  /* ------------------------------ AIEvents ------------------------------ */

  onWindup(point: THREE.Vector3, dur: number): void {
    this.marker.position.copy(point);
    this.marker.visible = true;
    this.markerT = dur;
    this.audio.sfx("cue");
    this.audio.setTension(1);
  }

  onStrike(point: THREE.Vector3): void {
    this.marker.visible = false;
    this.audio.setTension(0);
    if (!this.sm.is("playing")) return;
    const parryRadius = this.guarding ? TUNE.PARRY_RADIUS_GUARD : TUNE.PARRY_RADIUS;
    const tipD = this.player ? this.player.tipWorld.distanceTo(point) : 99;
    const dist = this.playerPos.z - this.enemyPos.z;
    const dodged = dist > TUNE.ENEMY_STRIKE_REACH || Math.abs(this.playerPos.x - point.x) > TUNE.DODGE_X;

    if (tipD < parryRadius) {
      // PARRY — the core skill moment
      this.ai.stagger();
      this.stats.parries++;
      this.sparks.spawn(point, 26, SPARK_STEEL, 4.4);
      this.audio.sfx("clang");
      this.audio.sfx("spark");
      this.hitstop = 0.1;
      this.shake = Math.max(this.shake, 0.25);
      this.flash("parry");
    } else if (dodged) {
      this.audio.sfx("whoosh");
    } else {
      // clean hit on the player
      const dmg = Math.round(11 + this.ai.aggression * 7);
      this.hpP = Math.max(0, this.hpP - dmg);
      this.stats.taken += dmg;
      this.sparks.spawn(point, 18, SPARK_HIT, 3.4);
      this.audio.sfx("thud");
      this.hitstop = 0.08;
      this.shake = 0.55;
      const s = bridge.getSnapshot();
      bridge.set({ hurtPulse: s.hurtPulse + 1, hpP: this.hpP });
      if (this.hpP <= 0) this.gameOver(false);
    }
  }

  onWhiff(): void {
    this.marker.visible = false;
    this.audio.setTension(0);
  }

  /* ------------------------------ update ------------------------------ */

  private update(rawDt: number): void {
    const dt = this.hitstop > 0 ? rawDt * 0.12 : rawDt;
    this.hitstop = Math.max(0, this.hitstop - rawDt);
    this.tGlobal += rawDt;

    // global keys
    if (this.input.consumeAction("Space") || this.input.consumeAction("Enter")) {
      if (this.sm.is("title")) this.start();
      else if (this.sm.is("gameover")) this.restart();
    }
    if (this.input.consumeAction("Escape") || this.input.consumeAction("KeyP")) {
      if (this.sm.is("playing")) this.pause();
      else if (this.sm.is("paused")) this.resume();
    }
    if (this.input.consumeAction("KeyM")) this.toggleMute();
    if (this.input.consumeAction("KeyR") && this.sm.is("gameover")) this.restart();

    if (this.sm.is("title")) {
      this.titleOrbit += rawDt * 0.12;
      this.idleScene(dt);
      return;
    }
    if (!this.sm.is("playing")) return;

    this.duelTime += dt;

    // countdown gates only combat, footwork stays live (and keeps the self-check happy)
    if (this.countdown > 0) {
      this.countdown -= dt;
      const tick = Math.ceil(this.countdown / TUNE.COUNTDOWN_STEP);
      if (tick < this.countdownTick && tick > 0) {
        this.countdownTick = tick;
        this.audio.sfx("count");
      }
      if (this.countdown <= 0) {
        this.audio.sfx("whoosh");
        this.pushHud();
      }
    } else if (this.introT > 0) {
      this.introT -= dt;
      if (this.introT <= 0) {
        this.audio.sfx("cue"); // the lesson is over — steel is live now
        bridge.set({ intro: false });
      }
    }

    this.updateFootwork(dt);
    this.updatePlayerBlade(dt);
    this.ai.aggression = 1 - this.hpE / TUNE.ENEMY_HP;
    this.ai.update(dt, {
      enemyPos: this.enemyPos,
      playerPos: this.playerPos,
      dist: this.playerPos.z - this.enemyPos.z,
      floorY: this.floorY,
      enabled: this.countdown <= 0 && this.introT <= 0,
    }, this);
    this.updateEnemy(dt);
    if (this.countdown <= 0) this.resolvePlayerHits(dt);
    this.updateHints();

    // marker pulse
    if (this.marker.visible) {
      this.markerT -= dt;
      const s = 1 + Math.sin(this.tGlobal * 18) * 0.35;
      this.marker.scale.setScalar(s);
      if (this.markerT <= 0) this.marker.visible = false;
    }

    this.shake = Math.max(0, this.shake - rawDt * 2.2);

    // graceful degradation: sustained low fps → drop pixel ratio once
    if (!this.degraded) {
      if (rawDt > 1 / 45) this.lowFpsTime += rawDt;
      else this.lowFpsTime = Math.max(0, this.lowFpsTime - rawDt * 0.5);
      if (this.lowFpsTime > 2) {
        this.degraded = true;
        this.renderer.setPixelRatio(1);
      }
    }

    // live HUD numbers (cheap: only when they actually changed)
    const hud = bridge.getSnapshot();
    if (hud.hpP !== this.hpP || hud.hpE !== this.hpE || hud.countdown !== Math.max(0, this.countdown)) {
      bridge.set({ hpP: this.hpP, hpE: this.hpE, countdown: Math.max(0, this.countdown) });
    }
  }

  private idleScene(dt: number): void {
    // title: both duelists hold en-garde, arena breathes (posePlayer also ticks the rig's idle anim)
    const S = this.shoulderWorld(_v1);
    _v2.set(S.x + 0.1, S.y - 0.4, S.z - 1.15);
    this.tip.lerp(_v2, 1 - Math.exp(-6 * dt));
    this.bladeDir.lerp(_v3.set(0.05, -0.3, -1).normalize(), 1 - Math.exp(-6 * dt)).normalize();
    this.posePlayer(dt);
    this.ai.update(dt, { enemyPos: this.enemyPos, playerPos: this.playerPos, dist: 3.4, floorY: this.floorY, enabled: false }, this);
    this.updateEnemy(dt);
  }

  private updateFootwork(dt: number): void {
    const sp = TUNE.MOVE_SPEED;
    let moved = 0;
    if (this.input.moveZ !== 0) {
      this.playerPos.z -= this.input.moveZ * sp * dt; // W (moveZ=+1) → toward the enemy (-z)
      moved += Math.abs(this.input.moveZ);
    }
    if (this.input.moveX !== 0) {
      this.playerPos.x += this.input.moveX * sp * dt * 0.85;
      moved += Math.abs(this.input.moveX);
    }
    this.playerPos.x = THREE.MathUtils.clamp(this.playerPos.x, -TUNE.STRAFE_LIMIT, TUNE.STRAFE_LIMIT);
    this.playerPos.z = THREE.MathUtils.clamp(
      this.playerPos.z,
      this.enemyPos.z + TUNE.MIN_DIST,
      Math.min(this.enemyPos.z + TUNE.MAX_DIST, 4.6),
    );
    if (moved > 0) {
      this.walkAcc += moved * sp * dt;
      if (this.walkAcc > 0.55) {
        this.walkAcc = 0;
        this.audio.sfx("step");
      }
    }
    this.player!.group.position.x = this.playerPos.x;
    this.player!.group.position.z = this.playerPos.z;
  }

  private updatePlayerBlade(dt: number): void {
    const S = this.shoulderWorld(_v1);

    // mouse ray → plane in front of the fencer
    this.raycaster.setFromCamera(this.mouseNdc, this.camera);
    this.bladePlane.constant = -(this.playerPos.z - TUNE.BLADE_PLANE);
    const hit = this.raycaster.ray.intersectPlane(this.bladePlane, _v2);
    if (hit) {
      if (this.thrustT > 0) _v2.z -= TUNE.THRUST_EXTEND;
      // clamp to the fencer's sphere of reach
      _v3.subVectors(_v2, S);
      const reach = TUNE.TIP_REACH + (this.thrustT > 0 ? 0.3 : 0);
      if (_v3.length() > reach) _v3.setLength(reach);
      _v2.copy(S).add(_v3);
      _v2.y = Math.max(_v2.y, this.floorY + 0.18);
    } else {
      _v2.copy(this.tip);
    }

    // the tip chases the cursor — weight comes from exponential lag
    const rate = this.thrustT > 0 ? TUNE.THRUST_RATE : this.guarding ? TUNE.TIP_RATE_GUARD : TUNE.TIP_RATE;
    this.prevTip.copy(this.tip);
    this.tip.lerp(_v2, 1 - Math.exp(-rate * dt));
    this.tipSpeed = this.tip.distanceTo(this.prevTip) / Math.max(dt, 1e-5);

    if (this.thrustT > 0) this.thrustT -= dt;

    // whoosh when a real swing starts
    if (this.tipSpeed > 5 && this.whooshArmed) {
      this.whooshArmed = false;
      this.audio.sfx("whoosh");
    } else if (this.tipSpeed < 2) {
      this.whooshArmed = true;
    }

    // blade points from shoulder through the tip (natural fencing line)
    _v3.subVectors(this.tip, S).normalize();
    this.bladeDir.lerp(_v3, 1 - Math.exp(-11 * dt)).normalize();

    this.posePlayer(dt);
  }

  /** resolve hand from tip+dir under arm-reach limits and pose the rig */
  private posePlayer(dt: number): void {
    const S = this.shoulderWorld(_v1);
    const bl = this.player!.bladeLen;
    _v2.copy(this.tip).addScaledVector(this.bladeDir, -bl); // hand = tip - dir * len
    _v3.subVectors(_v2, S);
    const maxHand = 0.66;
    if (_v3.length() > maxHand) {
      _v3.setLength(maxHand);
      _v2.copy(S).add(_v3);
      this.tip.copy(_v2).addScaledVector(this.bladeDir, bl);
    }
    this.player!.setBlade(_v2, this.bladeDir);
    this.player!.update(dt, this.tGlobal, Math.abs(this.input.moveX) + Math.abs(this.input.moveZ));
  }

  private updateEnemy(dt: number): void {
    // body follows the AI's footwork wishes
    this.enemyPos.x = THREE.MathUtils.clamp(this.enemyPos.x + this.ai.moveX * dt, -2.2, 2.2);
    this.enemyPos.z = THREE.MathUtils.clamp(this.enemyPos.z + this.ai.moveZ * dt, -4.6, this.playerPos.z - 1.2);
    this.enemy!.group.position.x = this.enemyPos.x;
    this.enemy!.group.position.z = this.enemyPos.z;

    // arm chases the AI's pose targets at the rate the state demands
    const k = 1 - Math.exp(-this.ai.poseRate * dt);
    this.enemyHand.lerp(this.ai.handTarget, k);
    this.enemyDir.lerp(this.ai.dirTarget, k).normalize();
    this.enemy!.setBlade(this.enemyHand, this.enemyDir);
    this.enemy!.update(dt, this.tGlobal, Math.abs(this.ai.moveX) + Math.abs(this.ai.moveZ));
  }

  private resolvePlayerHits(dt: number): void {
    this.hitCooldown -= dt;
    if (this.hitCooldown > 0 || !this.player || !this.enemy) return;
    const tip = this.player.tipWorld;
    const live = this.tipSpeed > TUNE.SLASH_MIN_SPEED || (this.thrustT > 0 && this.tipSpeed > 2);
    if (!live) return;

    const ep = this.enemyPos;
    const bodyD = distPointSeg(
      tip.x, tip.y, tip.z,
      ep.x, this.floorY + 0.25, ep.z,
      ep.x, this.floorY + 1.7, ep.z,
    );
    const eh = this.enemy.handWorld, et = this.enemy.tipWorld;
    const bladeD = distPointSeg(tip.x, tip.y, tip.z, eh.x, eh.y, eh.z, et.x, et.y, et.z);

    if (bodyD > TUNE.HIT_RADIUS && bladeD > TUNE.BLADE_BIND_RADIUS) return;

    if (bladeD <= TUNE.BLADE_BIND_RADIUS && (bodyD > TUNE.HIT_RADIUS || this.ai.isGuarding)) {
      // steel on steel: bind or guarded block
      this.sparks.spawn(tip, 12, SPARK_STEEL, 3);
      this.audio.sfx("clang");
      this.hitCooldown = TUNE.HIT_COOLDOWN * 0.7;
      this.shake = Math.max(this.shake, 0.12);
      this.flash("clang");
      return;
    }

    if (bodyD <= TUNE.HIT_RADIUS) {
      const riposte = this.ai.state === "stagger";
      const base = this.thrustT > 0 ? 13 : THREE.MathUtils.clamp(6 + (this.tipSpeed - TUNE.SLASH_MIN_SPEED) * 2.2, 7, 20);
      const dmg = Math.round(base * (riposte ? TUNE.RIPOSTE_MULT : 1));
      this.hpE = Math.max(0, this.hpE - dmg);
      this.stats.hits++;
      this.stats.dealt += dmg;
      this.enemy.hurtFlash();
      this.ai.hurt();
      this.sparks.spawn(tip, 16, SPARK_HIT, 3.6);
      this.audio.sfx("thud");
      this.audio.sfx("spark");
      this.hitCooldown = TUNE.HIT_COOLDOWN;
      this.hitstop = 0.07;
      this.shake = Math.max(this.shake, 0.3);
      this.flash(riposte ? "riposte" : "hit");
      if (this.hpE <= 0) this.gameOver(true);
    }
  }

  private updateHints(): void {
    let hint: string | null = null;
    if (this.countdown > 0) {
      hint = "Приготовьтесь…";
    } else if (this.introT > 0) {
      const t = TUNE.INTRO_TIME - this.introT;
      hint =
        t < 3.2
          ? "Ведите мышью — клинок следует за ней. Резкое движение — рубящий удар."
          : t < 6.4
            ? "ЛКМ — колющий выпад. W/S — дистанция, A/D — обход."
            : "Красный блик — атака врага: подставьте клинок для парирования. ПКМ — твёрдая защита.";
    } else if (this.ai.state === "stagger") {
      hint = "Враг открыт — рипост наносит двойной урон!";
    } else if (this.hpP <= 30) {
      hint = "Держите дистанцию (S) и парировать легче из защиты (ПКМ).";
    }
    if (bridge.getSnapshot().hint !== hint) bridge.set({ hint });
  }

  /* ------------------------------ render ------------------------------ */

  private render(): void {
    const t = this.tGlobal;
    this.arena?.update(1 / 60, t);

    if (this.sm.is("title")) {
      // slow orbit around the two duelists
      const a = this.titleOrbit;
      this.camera.position.set(Math.sin(a) * 5.6, 2.1 + Math.sin(t * 0.4) * 0.2, Math.cos(a) * 5.6);
      this.camera.lookAt(0, this.floorY + 1.1, 0);
    } else {
      // over-the-right-shoulder duel camera: player low-left, enemy clear in frame
      const px = this.playerPos.x;
      _v1.set(px * 0.5 + 1.05, this.floorY + 1.9, this.playerPos.z + 3.1);
      this.camera.position.copy(_v1);
      if (this.shake > 0) {
        this.camera.position.x += (Math.random() - 0.5) * this.shake * 0.12;
        this.camera.position.y += (Math.random() - 0.5) * this.shake * 0.12;
      }
      this.camera.lookAt(px * 0.3 - 0.15, this.floorY + 1.15, this.playerPos.z - 2.4);
    }

    // trails follow live blades
    if (this.player) {
      const activeP = this.sm.is("playing") && this.tipSpeed > 3.2;
      this.trailP.push(this.player.tipWorld, this.player.handWorld, activeP);
    }
    if (this.enemy) {
      this.trailE.push(this.enemy.tipWorld, this.enemy.handWorld, this.sm.is("playing") && this.ai.state === "strike");
    }
    this.sparks.update(1 / 60);

    this.renderer.render(this.scene, this.camera);
    window.__GAME_READY__ = true;
  }

  /* ------------------------------ misc ------------------------------ */

  /** fencer's feet position — used by the self-check probe in boot.ts */
  probe(): THREE.Vector3 {
    return this.playerPos;
  }

  private pushHud(): void {
    bridge.set({
      screen: this.sm.state,
      era: this.era,
      hpP: this.hpP,
      hpE: this.hpE,
      hpMax: TUNE.HP,
      countdown: Math.max(0, this.countdown),
      intro: this.introT > 0,
      muted: this.audio.muted,
      records: this.records,
      stats: { ...this.stats },
    });
  }

  private readonly onResize = (): void => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
  };

  dispose(): void {
    this.loop.stop();
    window.removeEventListener("resize", this.onResize);
    for (const off of this.unsub) off();
    this.unsub = [];
    this.input.dispose();
    this.audio.dispose();
    this.player?.dispose();
    this.enemy?.dispose();
    this.arena?.dispose();
    this.sparks.dispose();
    this.trailP.dispose();
    this.trailE.dispose();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.renderer.dispose();
    bridge.detach();
  }
}
