/**
 * rig.ts — parametric duelist: detailed body assembled from primitives, two-bone IK
 * sword arm, per-era armor/helmet/blade sets. No external assets — every part is
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

type Kind = EraConfig["blade"]["kind"];

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
    const me = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r * 0.85, 1, 10)), m);
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
    const kind = era.blade.kind;
    const body = this.mat(p.body);
    const trim = this.mat(p.trim, { metalness: kind === "rapier" ? 0.45 : 0.75, roughness: 0.42 });
    const dark = this.mat(p.dark);
    const skin = this.mat(p.head, { roughness: 0.85, metalness: 0 });
    const metal = this.mat(p.trim, { metalness: 0.9, roughness: 0.3 });

    // --- legs + boots ---
    this.legL = this.mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.85, 12), dark, 0.13, 0.5, 0);
    this.legR = this.mesh(new THREE.CylinderGeometry(0.085, 0.07, 0.85, 12), dark, -0.13, 0.5, 0);
    // knee cops
    this.mesh(new THREE.SphereGeometry(0.08, 10, 8), kind === "rapier" ? dark : trim, 0.13, 0.56, 0.06);
    this.mesh(new THREE.SphereGeometry(0.08, 10, 8), kind === "rapier" ? dark : trim, -0.13, 0.56, 0.06);
    // boots: shaft + toe, with a cuff
    for (const sx of [0.13, -0.13]) {
      this.mesh(new THREE.CylinderGeometry(0.1, 0.095, 0.16, 10), dark, sx, 0.13, 0);
      this.mesh(new THREE.BoxGeometry(0.14, 0.09, 0.26), dark, sx, 0.06, 0.04);
      this.mesh(new THREE.BoxGeometry(0.1, 0.05, 0.1), dark, sx, 0.045, 0.19); // toe cap
      this.mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.05, 10), kind === "rapier" ? body : trim, sx, 0.22, 0); // cuff
    }

    // --- pelvis + belt ---
    this.mesh(new THREE.BoxGeometry(0.32, 0.2, 0.22), dark, 0, 0.98, 0);
    this.mesh(new THREE.CylinderGeometry(0.215, 0.215, 0.06, 14), trim, 0, 1.05, 0);
    this.mesh(new THREE.BoxGeometry(0.07, 0.05, 0.02), metal, 0, 1.05, 0.215); // buckle

    // --- torso: lower + chest plates ---
    this.mesh(new THREE.CylinderGeometry(0.19, 0.215, 0.22, 14), body, 0, 1.17, 0);
    this.torsoMesh = this.mesh(new THREE.CylinderGeometry(0.155, 0.19, 0.42, 14), body, 0, 1.44, 0);
    this.mesh(new THREE.CylinderGeometry(0.165, 0.185, 0.09, 14), trim, 0, 1.56, 0); // collar band

    // era gear on the torso
    this.buildEraGear(era, { body, trim, dark, skin, metal });

    // --- neck + head ---
    this.mesh(new THREE.CylinderGeometry(0.055, 0.065, 0.09, 10), skin, 0, 1.68, 0);
    this.headGroup.position.set(0, 1.78, 0);
    this.group.add(this.headGroup);
    const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.13, 16, 12)), skin);
    head.scale.set(0.92, 1.05, 0.98);
    this.headGroup.add(head);
    this.buildHelmet(era, trim, dark, metal, skin);

    // --- static off-hand arm (fencer style, slightly behind) ---
    const sL = new THREE.Vector3(0.26, 1.52, 0);
    const eL = new THREE.Vector3(0.38, 1.18, -0.12);
    const hL = new THREE.Vector3(0.34, 1.0, -0.3);
    this.segment(sL, eL, 0.065, body);
    this.segment(eL, hL, 0.055, body);
    this.mesh(new THREE.SphereGeometry(0.062, 10, 8), dark, hL.x, hL.y, hL.z); // glove

    // --- dynamic sword arm (unit cylinders, posed every frame) ---
    this.upperArm = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.072, 0.06, 1, 10)), body);
    this.foreArm = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.062, 0.05, 1, 10)), body);
    this.group.add(this.upperArm, this.foreArm);
  }

  /** Era-specific armor / clothing over the torso + shoulders. */
  private buildEraGear(
    era: EraConfig,
    m: { body: THREE.MeshStandardMaterial; trim: THREE.MeshStandardMaterial; dark: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; metal: THREE.MeshStandardMaterial },
  ): void {
    switch (era.blade.kind) {
      case "rapier": {
        // tabard with a cross, wide collar, pauldron-less but puffed sleeves
        const tabard = this.mesh(new THREE.BoxGeometry(0.3, 0.4, 0.25), m.body, 0, 1.42, 0);
        tabard.scale.set(1.02, 1, 1.02);
        this.mesh(new THREE.BoxGeometry(0.05, 0.3, 0.015), m.trim, 0, 1.44, 0.135); // cross vertical
        this.mesh(new THREE.BoxGeometry(0.16, 0.05, 0.015), m.trim, 0, 1.5, 0.135); // cross horizontal
        this.mesh(new THREE.TorusGeometry(0.1, 0.035, 8, 16), m.skin, 0, 1.68, 0).rotateX(Math.PI / 2); // lace collar
        this.mesh(new THREE.SphereGeometry(0.095, 10, 8), m.body, 0.27, 1.52, 0); // puffed sleeves
        this.mesh(new THREE.SphereGeometry(0.095, 10, 8), m.body, -0.27, 1.52, 0);
        // skirt halves of the tabard
        this.mesh(new THREE.BoxGeometry(0.15, 0.22, 0.24), m.body, 0.085, 0.98, 0);
        this.mesh(new THREE.BoxGeometry(0.15, 0.22, 0.24), m.body, -0.085, 0.98, 0);
        break;
      }
      case "longsword": {
        // cuirass + big pauldrons + fauld strips
        this.mesh(new THREE.SphereGeometry(0.21, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m.metal, 0, 1.32, 0).scale.set(1, 1.15, 0.8);
        for (const sx of [0.28, -0.28]) {
          const p = this.mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.6), m.metal, sx, 1.6, 0);
          p.scale.set(1, 0.9, 1);
          this.mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.08, 10), m.metal, sx, 1.52, 0);
        }
        // fauld: overlapping skirt strips
        for (let i = 0; i < 3; i++) {
          this.mesh(new THREE.CylinderGeometry(0.22 + i * 0.008, 0.235 + i * 0.008, 0.045, 14, 1, true), m.metal, 0, 1.0 - i * 0.05, 0);
        }
        // couters (elbow) on the static arm
        this.mesh(new THREE.SphereGeometry(0.07, 10, 8), m.metal, 0.38, 1.18, -0.12);
        break;
      }
      case "katana": {
        // lamellar do: stacked rows around the torso
        for (let i = 0; i < 4; i++) {
          const row = this.mesh(new THREE.CylinderGeometry(0.185 + i * 0.009, 0.2 + i * 0.009, 0.075, 14), i % 2 ? m.dark : m.body, 0, 1.28 + i * 0.085, 0);
          row.scale.set(1, 1, 0.92);
        }
        // kusazuri: skirt plates, front/back/side
        for (const [x, z, ry] of [
          [0, 0.17, 0],
          [0, -0.17, Math.PI],
          [0.17, 0, Math.PI / 2],
          [-0.17, 0, -Math.PI / 2],
        ] as const) {
          const plate = this.mesh(new THREE.BoxGeometry(0.26, 0.22, 0.03), m.dark, x, 0.95, z);
          plate.rotation.y = ry;
          plate.rotation.x = ry === 0 ? 0.18 : ry === Math.PI ? -0.18 : 0;
          if (Math.abs(ry) === Math.PI / 2) plate.rotation.z = ry > 0 ? -0.18 : 0.18;
        }
        // sode shoulder guards: stacked plates
        for (const sx of [0.28, -0.28]) {
          for (let i = 0; i < 3; i++) {
            this.mesh(new THREE.BoxGeometry(0.16 - i * 0.02, 0.045, 0.2 - i * 0.02), i % 2 ? m.body : m.dark, sx + Math.sign(sx) * i * 0.012, 1.62 - i * 0.05, 0);
          }
        }
        break;
      }
      case "energy": {
        const strip = this.mat(era.accent, { emissive: era.accent, emissiveIntensity: 1.8, metalness: 0.4, roughness: 0.35 });
        // glowing chest core + strips
        this.mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), strip, 0, 1.48, 0.16).rotateX(Math.PI / 2);
        this.mesh(new THREE.BoxGeometry(0.02, 0.3, 0.012), strip, 0.1, 1.42, 0.165);
        this.mesh(new THREE.BoxGeometry(0.02, 0.3, 0.012), strip, -0.1, 1.42, 0.165);
        this.mesh(new THREE.BoxGeometry(0.02, 0.5, 0.012), strip, 0.1, 0.62, 0.085);
        this.mesh(new THREE.BoxGeometry(0.02, 0.5, 0.012), strip, -0.16, 0.62, 0.085);
        // angular shoulder shells
        for (const sx of [0.27, -0.27]) {
          const sh = this.mesh(new THREE.BoxGeometry(0.14, 0.08, 0.18), m.dark, sx, 1.6, 0);
          sh.rotation.z = -Math.sign(sx) * 0.25;
          this.mesh(new THREE.BoxGeometry(0.15, 0.015, 0.02), strip, sx, 1.56, 0.08);
        }
        break;
      }
    }
  }

  private buildHelmet(
    era: EraConfig,
    trim: THREE.MeshStandardMaterial,
    dark: THREE.MeshStandardMaterial,
    metal: THREE.MeshStandardMaterial,
    skin: THREE.MeshStandardMaterial,
  ): void {
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
      const me = new THREE.Mesh(this.geo(g), m);
      me.position.set(x, y, z);
      this.headGroup.add(me);
      return me;
    };
    switch (era.blade.kind) {
      case "rapier": {
        // face: eyes + mustache
        add(new THREE.SphereGeometry(0.018, 8, 6), dark, 0.05, 0.02, 0.115);
        add(new THREE.SphereGeometry(0.018, 8, 6), dark, -0.05, 0.02, 0.115);
        const mus = add(new THREE.BoxGeometry(0.09, 0.02, 0.03), dark, 0, -0.05, 0.12);
        mus.rotation.z = 0.06;
        // wide-brim hat, tilted, with a feather
        const hat = new THREE.Group();
        hat.position.set(0, 0.1, 0);
        hat.rotation.z = 0.12;
        this.headGroup.add(hat);
        const hadd = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => {
          const me = new THREE.Mesh(this.geo(g), m);
          me.position.set(x, y, z);
          hat.add(me);
          return me;
        };
        hadd(new THREE.CylinderGeometry(0.26, 0.28, 0.025, 18), dark, 0, 0, 0);
        hadd(new THREE.CylinderGeometry(0.115, 0.135, 0.17, 14), dark, 0, 0.09, 0);
        hadd(new THREE.CylinderGeometry(0.14, 0.14, 0.035, 14), trim, 0, 0.02, 0);
        // feather
        const feather = hadd(new THREE.ConeGeometry(0.03, 0.22, 6), trim, 0.12, 0.16, -0.02);
        feather.rotation.z = -0.7;
        break;
      }
      case "longsword": {
        // great helm: dome + face plate + visor slit + breathing holes + plume
        add(new THREE.CylinderGeometry(0.145, 0.155, 0.2, 14), metal, 0, 0.02, 0);
        add(new THREE.SphereGeometry(0.14, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, 0.12, 0);
        add(new THREE.BoxGeometry(0.22, 0.028, 0.05), dark, 0, 0.045, 0.12); // visor slit
        for (let i = 0; i < 3; i++) {
          add(new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6), dark, 0.05 - i * 0.05, -0.045, 0.135).rotateX(Math.PI / 2);
        }
        // crest ridge + plume
        add(new THREE.BoxGeometry(0.02, 0.06, 0.2), trim, 0, 0.22, -0.02);
        const plume = add(new THREE.ConeGeometry(0.035, 0.24, 6), trim, 0, 0.3, -0.06);
        plume.rotation.x = 0.5;
        break;
      }
      case "katana": {
        // kabuto: multi-plate bowl + neck guard + big crescent maedate + menpo mask
        add(new THREE.SphereGeometry(0.148, 16, 10, 0, Math.PI * 2, 0, Math.PI / 1.9), dark, 0, 0.03, 0);
        // bowl ridges
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2;
          const ridge = add(new THREE.BoxGeometry(0.012, 0.1, 0.012), metal, Math.cos(a) * 0.1, 0.09, Math.sin(a) * 0.1);
          ridge.rotation.z = -Math.cos(a) * 0.5;
          ridge.rotation.x = Math.sin(a) * 0.5;
        }
        // shikoro neck guard: flared rings
        for (let i = 0; i < 3; i++) {
          add(new THREE.CylinderGeometry(0.165 + i * 0.018, 0.185 + i * 0.02, 0.04, 14, 1, true), i % 2 ? trim : dark, 0, -0.02 - i * 0.045, 0);
        }
        // fukigaeshi side wings
        for (const sx of [0.14, -0.14]) {
          const wing = add(new THREE.BoxGeometry(0.02, 0.09, 0.11), trim, sx, 0.05, 0.02);
          wing.rotation.z = -Math.sign(sx) * 0.35;
        }
        // maedate: golden crescent
        const cres = add(new THREE.TorusGeometry(0.085, 0.016, 8, 20, Math.PI * 1.1), metal, 0, 0.14, 0.1);
        cres.rotation.z = Math.PI * 0.95 - Math.PI * 0.55;
        add(new THREE.CylinderGeometry(0.014, 0.014, 0.05, 6), metal, 0, 0.1, 0.115);
        // menpo face mask
        add(new THREE.SphereGeometry(0.125, 12, 8, 0, Math.PI * 2, Math.PI / 2.6, Math.PI / 2), dark, 0, 0.01, 0.008);
        break;
      }
      case "energy": {
        // full sleek helmet: shell + glowing visor band + antenna
        const visor = this.mat(0x0a0a12, { emissive: era.accent, emissiveIntensity: 2.2, metalness: 0.5, roughness: 0.3 });
        add(new THREE.SphereGeometry(0.145, 16, 12), dark, 0, 0.02, 0);
        const band = add(new THREE.CylinderGeometry(0.148, 0.15, 0.055, 16, 1, true), visor, 0, 0.03, 0);
        band.scale.set(1, 1, 1.02);
        add(new THREE.BoxGeometry(0.16, 0.02, 0.03), visor, 0, 0.03, 0.13);
        // fin + antenna
        const fin = add(new THREE.BoxGeometry(0.015, 0.1, 0.16), trim, 0, 0.16, -0.02);
        fin.rotation.x = -0.15;
        add(new THREE.CylinderGeometry(0.006, 0.006, 0.14, 6), trim, 0.1, 0.14, -0.04).rotation.z = -0.25;
        add(new THREE.SphereGeometry(0.014, 8, 6), visor, 0.117, 0.2, -0.04);
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
    const trim = this.mat(p.trim, { metalness: 0.85, roughness: 0.3 });
    const grip = this.mat(p.dark, { roughness: 0.9 });
    const wrap = this.mat(p.body, { roughness: 0.95 });

    const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
      const me = new THREE.Mesh(this.geo(g), m);
      me.position.set(x, y, z);
      this.sword.add(me);
      return me;
    };

    // grip: wrapped handle + pommel (blade extends along +z from the guard)
    add(new THREE.CylinderGeometry(0.022, 0.026, 0.17, 10), grip, 0, 0, -0.1).rotateX(Math.PI / 2);
    // grip wrap rings
    for (let i = 0; i < 4; i++) {
      add(new THREE.TorusGeometry(0.025, 0.005, 6, 12), wrap, 0, 0, -0.05 - i * 0.035);
    }
    add(new THREE.SphereGeometry(0.034, 10, 8), trim, 0, 0, -0.2);

    switch (b.kind) {
      case "rapier": {
        // swept hilt: main ring + cross + side bars
        add(new THREE.TorusGeometry(0.075, 0.012, 8, 20), trim, 0, 0, 0.01);
        add(new THREE.TorusGeometry(0.05, 0.009, 8, 16), trim, 0, 0.045, -0.02).rotateY(Math.PI / 2);
        add(new THREE.BoxGeometry(0.18, 0.02, 0.02), trim, 0, 0, 0.01);
        const bar1 = add(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), trim, 0.075, 0, -0.045);
        bar1.rotation.x = Math.PI / 2;
        bar1.rotation.z = 0.2;
        const bar2 = add(new THREE.CylinderGeometry(0.008, 0.008, 0.14, 6), trim, -0.075, 0, -0.045);
        bar2.rotation.x = Math.PI / 2;
        bar2.rotation.z = -0.2;
        // blade: hexagonal section with a tip
        add(new THREE.CylinderGeometry(b.width * 0.5, b.width, b.length * 0.92, 6), this.bladeMat, 0, 0, b.length * 0.46 + 0.02).rotateX(Math.PI / 2);
        add(new THREE.ConeGeometry(b.width * 0.5, b.length * 0.08, 6), this.bladeMat, 0, 0, b.length * 0.96 + 0.02).rotateX(Math.PI / 2);
        break;
      }
      case "longsword": {
        // cruciform hilt with scent-stopper pommel
        add(new THREE.BoxGeometry(0.26, 0.035, 0.04), trim, 0, 0, 0.01);
        add(new THREE.SphereGeometry(0.03, 8, 6), trim, 0.14, 0, 0.01);
        add(new THREE.SphereGeometry(0.03, 8, 6), trim, -0.14, 0, 0.01);
        // blade with a fuller groove
        add(new THREE.BoxGeometry(b.width, b.thick, b.length * 0.94), this.bladeMat, 0, 0, b.length * 0.47 + 0.02);
        const fuller = this.mat(p.dark, { metalness: 0.9, roughness: 0.4 });
        add(new THREE.BoxGeometry(b.width * 0.25, b.thick + 0.002, b.length * 0.6), fuller, 0, 0, b.length * 0.35 + 0.02);
        add(new THREE.ConeGeometry(b.width * 0.5, b.length * 0.06, 4), this.bladeMat, 0, 0, b.length * 0.97 + 0.02).rotateX(Math.PI / 2);
        break;
      }
      case "katana": {
        // round tsuba with rim + wrapped tsuka + menuki dots
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.014, 16), trim, 0, 0, 0.01).rotateX(Math.PI / 2);
        add(new THREE.TorusGeometry(0.06, 0.008, 8, 20), trim, 0, 0, 0.01);
        add(new THREE.SphereGeometry(0.01, 6, 5), trim, 0.02, 0.015, -0.08);
        add(new THREE.SphereGeometry(0.01, 6, 5), trim, -0.02, -0.015, -0.12);
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
        // emitter claws
        for (const sx of [0.035, -0.035]) {
          add(new THREE.BoxGeometry(0.02, 0.02, 0.08), trim, sx, 0, 0.05);
        }
        // bright core + soft sheath
        const core = this.mat(0xffffff, { emissive: era.accent, emissiveIntensity: 3.2, metalness: 0, roughness: 0.5 });
        add(new THREE.CylinderGeometry(b.width * 0.5, b.width * 0.62, b.length, 10), this.bladeMat, 0, 0, b.length / 2 + 0.02).rotateX(Math.PI / 2);
        add(new THREE.CylinderGeometry(b.width * 0.2, b.width * 0.24, b.length, 8), core, 0, 0, b.length / 2 + 0.02).rotateX(Math.PI / 2);
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
