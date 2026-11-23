/**
 * rig.ts — parametric duelist: body assembled from primitives, two-bone IK sword arm,
 * per-era helmet and blade. No external assets, no raw coordinate dumps — every part is
 * derived from a few body constants.
 */

import * as THREE from "three";
import type { EraConfig } from "./config";

export interface DuelistPalette {
  body: number;
  trim: number;
  head: number;
  dark: number;
}

const L1 = 0.34; // upper arm
const L2 = 0.34; // forearm + fist
const UP = new THREE.Vector3(0, 1, 0);
const FWD = new THREE.Vector3(0, 0, 1);

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _e = new THREE.Vector3();
const _q = new THREE.Quaternion();

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export class Duelist {
  readonly group = new THREE.Group();
  readonly bladeLen: number;
  readonly facing: 1 | -1; // +1 faces +z, -1 faces -z

  private geoms: THREE.BufferGeometry[] = [];
  private mats: THREE.MeshStandardMaterial[] = [];
  private baseEmissive: THREE.Color[] = [];

  private upperArm!: THREE.Mesh;
  private foreArm!: THREE.Mesh;
  private sword = new THREE.Group();
  private bladeMat!: THREE.MeshStandardMaterial;
  private shoulderLocal: THREE.Vector3;
  private poleLocal: THREE.Vector3;
  private torsoMesh!: THREE.Mesh;
  private headGroup = new THREE.Group();

  private flash = 0;
  private walkPhase = 0;
  private legL!: THREE.Mesh;
  private legR!: THREE.Mesh;
  private idleSeed = Math.random() * 10;

  /** Local-space current hand position / blade direction (used for trails and clash checks). */
  readonly handWorld = new THREE.Vector3();
  readonly dirWorld = new THREE.Vector3(0, 0, 1);
  readonly tipWorld = new THREE.Vector3();

  constructor(era: EraConfig, palette: DuelistPalette, facing: 1 | -1) {
    this.facing = facing;
    this.bladeLen = era.blade.length;
    // right side of a body facing +z is -x (right = forward × up)
    this.shoulderLocal = new THREE.Vector3(-0.26, 1.42, 0);
    this.poleLocal = new THREE.Vector3(-0.9, -0.55, -0.2).normalize();

    this.buildBody(era, palette);
    this.buildSword(era, palette);
    if (facing === -1) this.group.rotation.y = Math.PI;
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.castShadow = true;
      }
    });
  }

  /* ------------------------------ construction ------------------------------ */

  private mat(color: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: 0.72, metalness: 0.18, ...extra });
    this.mats.push(m);
    this.baseEmissive.push(m.emissive.clone());
    return m;
  }

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geoms.push(g);
    return g;
  }

  private mesh(g: THREE.BufferGeometry, m: THREE.MeshStandardMaterial, x = 0, y = 0, z = 0): THREE.Mesh {
    const me = new THREE.Mesh(this.geo(g), m);
    me.position.set(x, y, z);
    this.group.add(me);
    return me;
  }

  /** cylinder spanning a→b, parented to the group (for static limbs) */
  private segment(a: THREE.Vector3, b: THREE.Vector3, r: number, m: THREE.MeshStandardMaterial): THREE.Mesh {
    const me = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r * 0.85, 1, 8)), m);
    this.group.add(me);
    this.setSegment(me, a, b);
    return me;
  }

  /** position/scale a unit-height cylinder mesh so it spans a→b (local space) */
  private setSegment(me: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3): void {
    _a.subVectors(b, a);
    const len = Math.max(_a.length(), 1e-4);
    me.position.copy(a).addScaledVector(_a, 0.5);
    me.scale.set(1, len, 1);
    me.quaternion.setFromUnitVectors(UP, _a.normalize());
  }

  private buildBody(era: EraConfig, p: DuelistPalette): void {
    const body = this.mat(p.body);
    const trim = this.mat(p.trim, { metalness: 0.35, roughness: 0.5 });
    const dark = this.mat(p.dark);
    const skin = this.mat(p.head);

    // legs
    this.legL = this.mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.85, 8), dark, 0.13, 0.5, 0);
    this.legR = this.mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.85, 8), dark, -0.13, 0.5, 0);
    this.mesh(new THREE.BoxGeometry(0.14, 0.09, 0.26), dark, 0.13, 0.06, 0.04);
    this.mesh(new THREE.BoxGeometry(0.14, 0.09, 0.26), dark, -0.13, 0.06, 0.04);

    // pelvis + torso
    this.mesh(new THREE.BoxGeometry(0.32, 0.2, 0.22), dark, 0, 0.98, 0);
    this.torsoMesh = this.mesh(new THREE.CylinderGeometry(0.16, 0.21, 0.58, 10), body, 0, 1.3, 0);
    // chest trim band + belt
    this.mesh(new THREE.CylinderGeometry(0.175, 0.19, 0.1, 10), trim, 0, 1.42, 0);
    this.mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.06, 10), trim, 0, 1.05, 0);
    // shoulder pads
    this.mesh(new THREE.SphereGeometry(0.09, 8, 6), trim, 0.27, 1.45, 0);
    this.mesh(new THREE.SphereGeometry(0.09, 8, 6), trim, -0.27, 1.45, 0);

    // head + per-era helmet
    this.headGroup.position.set(0, 1.62, 0);
    this.group.add(this.headGroup);
    const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.13, 12, 10)), skin);
    this.headGroup.add(head);
    this.buildHelmet(era, trim, dark);

    // static off-hand arm (slightly behind the body, fencer style)
    const sL = new THREE.Vector3(0.26, 1.42, 0);
    const eL = new THREE.Vector3(0.38, 1.14, -0.12);
    const hL = new THREE.Vector3(0.34, 0.98, -0.3);
    this.segment(sL, eL, 0.065, body);
    this.segment(eL, hL, 0.055, body);
    this.mesh(new THREE.SphereGeometry(0.06, 8, 6), skin, hL.x, hL.y, hL.z);

    // dynamic sword arm (unit cylinders, posed every frame)
    this.upperArm = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.07, 0.06, 1, 8)), body);
    this.foreArm = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.06, 0.05, 1, 8)), body);
    this.group.add(this.upperArm, this.foreArm);
  }

  private buildHelmet(era: EraConfig, trim: THREE.MeshStandardMaterial, dark: THREE.MeshStandardMaterial): void {
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const me = new THREE.Mesh(this.geo(g), m);
      me.position.set(x, y, z);
      this.headGroup.add(me);
      return me;
    };
    switch (era.blade.kind) {
      case "rapier": {
        // wide-brim musketeer hat
        add(new THREE.CylinderGeometry(0.24, 0.26, 0.025, 14), dark, 0, 0.1, 0);
        add(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 12), dark, 0, 0.18, 0);
        add(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 12), trim, 0, 0.12, 0);
        break;
      }
      case "longsword": {
        // great helm with a visor slit
        add(new THREE.CylinderGeometry(0.14, 0.15, 0.22, 12), trim, 0, 0.04, 0);
        add(new THREE.SphereGeometry(0.13, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), trim, 0, 0.13, 0);
        add(new THREE.BoxGeometry(0.2, 0.03, 0.06), dark, 0, 0.05, 0.11);
        break;
      }
      case "katana": {
        // kabuto: bowl + neck guard + small crest
        add(new THREE.SphereGeometry(0.145, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.8), dark, 0, 0.03, 0);
        add(new THREE.CylinderGeometry(0.17, 0.19, 0.05, 12, 1, true), trim, 0, -0.02, 0);
        add(new THREE.BoxGeometry(0.03, 0.14, 0.06), trim, 0, 0.16, 0.1);
        break;
      }
      case "energy": {
        // sleek visor
        const visor = this.mat(0x0a0a12, { emissive: era.accent, emissiveIntensity: 1.6 });
        add(new THREE.SphereGeometry(0.14, 12, 10), dark, 0, 0.02, 0);
        add(new THREE.BoxGeometry(0.2, 0.05, 0.05), visor, 0, 0.02, 0.1);
        break;
      }
    }
  }

  private buildSword(era: EraConfig, p: DuelistPalette): void {
    const b = era.blade;
    this.bladeMat = this.mat(b.color, {
      metalness: b.kind === "energy" ? 0.1 : 0.9,
      roughness: b.kind === "energy" ? 0.4 : 0.25,
      emissive: b.emissive,
      emissiveIntensity: b.emissiveIntensity,
    });
    const trim = this.mat(p.trim, { metalness: 0.7, roughness: 0.35 });
    const grip = this.mat(p.dark, { roughness: 0.9 });

    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const me = new THREE.Mesh(this.geo(g), m);
      me.position.set(x, y, z);
      this.sword.add(me);
      return me;
    };

    // blade extends along +z from the guard
    add(new THREE.CylinderGeometry(0.022, 0.026, 0.17, 8), grip, 0, 0, -0.1).rotateX(Math.PI / 2);
    add(new THREE.SphereGeometry(0.032, 8, 6), trim, 0, 0, -0.2);

    switch (b.kind) {
      case "rapier": {
        add(new THREE.TorusGeometry(0.075, 0.012, 8, 18), trim, 0, 0, 0.01);
        add(new THREE.BoxGeometry(0.18, 0.022, 0.022), trim, 0, 0, 0.01);
        add(new THREE.CylinderGeometry(b.width * 0.5, b.width, b.length * 0.92, 6), this.bladeMat, 0, 0, b.length * 0.46 + 0.02).rotateX(Math.PI / 2);
        add(new THREE.ConeGeometry(b.width * 0.5, b.length * 0.08, 6), this.bladeMat, 0, 0, b.length * 0.96 + 0.02).rotateX(Math.PI / 2);
        break;
      }
      case "longsword": {
        add(new THREE.BoxGeometry(0.26, 0.035, 0.04), trim, 0, 0, 0.01);
        add(new THREE.BoxGeometry(b.width, b.thick, b.length * 0.94), this.bladeMat, 0, 0, b.length * 0.47 + 0.02);
        add(new THREE.ConeGeometry(b.width * 0.5, b.length * 0.06, 4), this.bladeMat, 0, 0, b.length * 0.97 + 0.02).rotateX(Math.PI / 2);
        break;
      }
      case "katana": {
        add(new THREE.CylinderGeometry(0.055, 0.055, 0.015, 12), trim, 0, 0, 0.01).rotateX(Math.PI / 2);
        // two segments with a slight angle to suggest the curve
        const seg1 = add(new THREE.BoxGeometry(b.width, b.thick, b.length * 0.55), this.bladeMat, 0, 0, b.length * 0.275 + 0.02);
        const seg2 = add(new THREE.BoxGeometry(b.width * 0.8, b.thick, b.length * 0.45), this.bladeMat, 0, 0.035, b.length * 0.775 + 0.02);
        seg2.rotation.x = -0.1;
        seg1.rotation.x = -0.02;
        break;
      }
      case "energy": {
        const emitter = this.mat(0x1a1a24, { emissive: era.accent, emissiveIntensity: 1.2, metalness: 0.6 });
        add(new THREE.BoxGeometry(0.09, 0.06, 0.06), emitter, 0, 0, 0.01);
        add(new THREE.CylinderGeometry(b.width * 0.5, b.width * 0.62, b.length, 8), this.bladeMat, 0, 0, b.length / 2 + 0.02).rotateX(Math.PI / 2);
        break;
      }
    }
    this.group.add(this.sword);
  }

  /* -------------------------------- posing -------------------------------- */

  /**
   * Pose the sword arm. handWorld: desired hilt position (world);
   * dirWorld: desired blade direction (world, will be normalized).
   */
  setBlade(handWorld: THREE.Vector3, dirWorld: THREE.Vector3): void {
    // world → local (group only ever yaws, but do it properly)
    const hl = _b.copy(handWorld);
    this.group.worldToLocal(hl);
    this.group.getWorldQuaternion(_q).invert();
    const dl = _c.copy(dirWorld).applyQuaternion(_q);
    if (dl.lengthSq() < 1e-6) dl.set(0, 0, 1);
    dl.normalize();

    // two-bone IK: shoulder fixed, hand clamped to reach
    const S = this.shoulderLocal;
    const SH = _d.subVectors(hl, S);
    let d = SH.length();
    const maxD = (L1 + L2) * 0.99;
    if (d > maxD) {
      SH.multiplyScalar(maxD / d);
      d = maxD;
      hl.copy(S).add(SH);
    } else if (d < 0.12) {
      SH.normalize().multiplyScalar(0.12);
      d = 0.12;
      hl.copy(S).add(SH);
    }
    const dir = SH.normalize();
    const cosA = clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
    const along = L1 * cosA;
    const side = L1 * Math.sqrt(Math.max(0, 1 - cosA * cosA));
    // elbow hinge axis: pole minus its projection on the bone direction
    // (perp and elbow must live in different temps — they are both needed in the sum)
    const perp = _a.copy(this.poleLocal).addScaledVector(dir, -this.poleLocal.dot(dir));
    if (perp.lengthSq() < 1e-5) perp.set(0, -1, 0).addScaledVector(dir, dir.y);
    perp.normalize();
    const elbow = _e.copy(S).addScaledVector(dir, along).addScaledVector(perp, side);

    this.setSegment(this.upperArm, S, elbow);
    this.setSegment(this.foreArm, elbow, hl);

    this.sword.position.copy(hl);
    this.sword.quaternion.setFromUnitVectors(FWD, dl);

    // remember world-space result for clash checks / trails
    this.handWorld.copy(hl);
    this.group.localToWorld(this.handWorld);
    this.dirWorld.copy(dl).applyQuaternion(this.group.getWorldQuaternion(_q)).normalize();
    this.tipWorld.copy(this.handWorld).addScaledVector(this.dirWorld, this.bladeLen);
  }

  /** idle breathing, walk bob, hurt flash — cheap procedural life */
  update(dt: number, t: number, moveSpeed: number): void {
    this.walkPhase += dt * (2 + moveSpeed * 4.5);
    const bob = moveSpeed > 0.05 ? Math.abs(Math.sin(this.walkPhase)) * 0.05 : Math.sin(t * 1.7 + this.idleSeed) * 0.012;
    this.group.position.y = bob;
    const sway = moveSpeed > 0.05 ? Math.sin(this.walkPhase) * 0.5 : 0;
    this.legL.rotation.x = sway * 0.45;
    this.legR.rotation.x = -sway * 0.45;
    this.torsoMesh.rotation.y = Math.sin(t * 1.1 + this.idleSeed) * 0.03;
    this.headGroup.rotation.y = Math.sin(t * 0.7 + this.idleSeed * 2) * 0.08;

    if (this.flash > 0) {
      this.flash = Math.max(0, this.flash - dt * 4);
      const f = this.flash;
      for (let i = 0; i < this.mats.length; i++) {
        this.mats[i].emissive.copy(this.baseEmissive[i]).lerp(FLASH_COLOR, f);
        if (this.mats[i] === this.bladeMat) continue;
        this.mats[i].emissiveIntensity = 1;
      }
    }
  }

  hurtFlash(): void {
    this.flash = 1;
  }

  dispose(): void {
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geoms = [];
    this.mats = [];
    this.baseEmissive = [];
    this.group.removeFromParent();
  }
}

const FLASH_COLOR = new THREE.Color(0xaa1818);
