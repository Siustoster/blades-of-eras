/**
 * arena.ts — one procedural arena per era: geometry, mood lighting, ambient particles.
 * Everything is built from primitives; update() keeps the scene alive (flicker, sway, drift).
 */

import * as THREE from "three";
import type { EraConfig } from "./config";

export interface ArenaHandle {
  group: THREE.Group;
  floorY: number;
  update(dt: number, t: number): void;
  dispose(): void;
}

interface ParticleField {
  points: THREE.Points;
  vel: Float32Array;
  area: { x: number; y: number; z: number };
  mode: EraConfig["ambient"];
  sway: number;
}

function makeField(mode: EraConfig["ambient"], count: number, color: number): ParticleField {
  const area = { x: 34, y: 9, z: 34 };
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area.x;
    pos[i * 3 + 1] = Math.random() * area.y;
    pos[i * 3 + 2] = (Math.random() - 0.5) * area.z;
    const fall = mode === "petals" ? -0.35 : mode === "embers" ? 0.45 : mode === "streaks" ? -6 : -0.06;
    vel[i * 3] = (Math.random() - 0.5) * (mode === "petals" ? 0.5 : 0.2);
    vel[i * 3 + 1] = fall * (0.6 + Math.random() * 0.8);
    vel[i * 3 + 2] = (Math.random() - 0.5) * (mode === "petals" ? 0.5 : 0.2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({
    color,
    size: mode === "streaks" ? 0.05 : mode === "petals" ? 0.07 : 0.05,
    transparent: true,
    opacity: mode === "motes" ? 0.5 : 0.85,
    depthWrite: false,
    blending: mode === "petals" ? THREE.NormalBlending : THREE.AdditiveBlending,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(g, m);
  points.frustumCulled = false;
  return { points, vel, area, mode, sway: Math.random() * 10 };
}

export function buildArena(era: EraConfig, particleBudget: number): ArenaHandle {
  const group = new THREE.Group();
  const geoms: THREE.BufferGeometry[] = [];
  const mats: THREE.Material[] = [];
  const updaters: Array<(dt: number, t: number) => void> = [];
  let floorY = 0;

  const geo = <T extends THREE.BufferGeometry>(g: T): T => (geoms.push(g), g);
  const mat = (m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial => (mats.push(m), m);
  const box = (w: number, h: number, d: number, m: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
    const me = new THREE.Mesh(geo(new THREE.BoxGeometry(w, h, d)), m);
    me.position.set(x, y, z);
    me.castShadow = true;
    me.receiveShadow = true;
    group.add(me);
    return me;
  };
  const cyl = (r0: number, r1: number, h: number, m: THREE.Material, x: number, y: number, z: number, seg = 10): THREE.Mesh => {
    const me = new THREE.Mesh(geo(new THREE.CylinderGeometry(r0, r1, h, seg)), m);
    me.position.set(x, y, z);
    me.castShadow = true;
    me.receiveShadow = true;
    group.add(me);
    return me;
  };

  /* ------------------------------- ground ------------------------------- */
  const groundMat = mat(new THREE.MeshStandardMaterial({ color: era.ground, roughness: 0.95, metalness: 0 }));
  const ground = new THREE.Mesh(geo(new THREE.PlaneGeometry(80, 80)), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // dueling ring — the ritual circle both fighters respect
  const ringMat = mat(
    new THREE.MeshStandardMaterial({
      color: era.accent,
      emissive: era.accent,
      emissiveIntensity: era.blade.kind === "energy" ? 1.2 : 0.25,
      roughness: 0.6,
    }),
  );

  /* ----------------------------- era props ------------------------------ */
  switch (era.id) {
    case "musketeer": {
      const stone = mat(new THREE.MeshStandardMaterial({ color: 0x9a8878, roughness: 0.9 }));
      const stoneDark = mat(new THREE.MeshStandardMaterial({ color: 0x6a5a4c, roughness: 0.9 }));
      // colonnade around the courtyard
      for (const sx of [-1, 1]) {
        for (let i = 0; i < 3; i++) {
          const z = -5 + i * 5;
          cyl(0.32, 0.38, 4.4, stone, sx * 4.6, 2.2, z);
          box(0.9, 0.3, 0.9, stoneDark, sx * 4.6, 4.55, z);
          box(0.85, 0.25, 0.85, stoneDark, sx * 4.6, 0.12, z);
        }
        box(1.1, 0.35, 15, stoneDark, sx * 4.6, 4.9, 0);
      }
      // back wall with arched doorway
      box(14, 4.5, 0.6, stone, 0, 2.25, -7.5);
      box(2.2, 2.6, 0.7, stoneDark, 0, 1.3, -7.4);
      // banners that sway
      const cloth = mat(new THREE.MeshStandardMaterial({ color: 0x8a2432, roughness: 0.8, side: THREE.DoubleSide }));
      for (const sx of [-1, 1]) {
        const banner = new THREE.Mesh(geo(new THREE.PlaneGeometry(0.9, 2.2, 1, 4)), cloth);
        banner.position.set(sx * 4.55, 3.4, 0);
        group.add(banner);
        const phase = sx;
        updaters.push((dt, t) => {
          banner.rotation.z = Math.sin(t * 1.3 + phase) * 0.06;
          banner.rotation.x = Math.sin(t * 0.9 + phase * 2) * 0.04;
        });
      }
      break;
    }
    case "knight": {
      const stone = mat(new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.95 }));
      const stoneDark = mat(new THREE.MeshStandardMaterial({ color: 0x272b34, roughness: 0.95 }));
      // castle walls + battlements
      box(16, 5, 1, stone, 0, 2.5, -8);
      box(1, 5, 16, stone, -8, 2.5, 0);
      box(1, 5, 16, stone, 8, 2.5, 0);
      for (let i = 0; i < 8; i++) {
        box(0.9, 0.7, 0.9, stoneDark, -7 + i * 2, 5.35, -8);
      }
      // corner tower
      cyl(1.6, 1.8, 7, stoneDark, -7.5, 3.5, -7.5, 12);
      cyl(1.9, 1.6, 1, stone, -7.5, 7.2, -7.5, 12);
      // braziers with flickering light
      const iron = mat(new THREE.MeshStandardMaterial({ color: 0x1a1a1e, roughness: 0.6, metalness: 0.8 }));
      const flame = mat(new THREE.MeshStandardMaterial({ color: 0xff7020, emissive: 0xff8020, emissiveIntensity: 2.6 }));
      for (const sx of [-1, 1]) {
        cyl(0.08, 0.12, 1.5, iron, sx * 3.2, 0.75, -3.4);
        cyl(0.3, 0.18, 0.25, iron, sx * 3.2, 1.55, -3.4);
        const f = new THREE.Mesh(geo(new THREE.ConeGeometry(0.2, 0.55, 8)), flame);
        f.position.set(sx * 3.2, 1.95, -3.4);
        group.add(f);
        const light = new THREE.PointLight(0xff8030, 14, 10, 2);
        light.position.set(sx * 3.2, 2.1, -3.4);
        group.add(light);
        const phase = sx * 3;
        updaters.push((dt, t) => {
          light.intensity = 12 + Math.sin(t * 13 + phase) * 2 + Math.sin(t * 7.3) * 1.6;
          f.scale.y = 1 + Math.sin(t * 11 + phase) * 0.18;
        });
      }
      break;
    }
    case "samurai": {
      const wood = mat(new THREE.MeshStandardMaterial({ color: 0x8a6a48, roughness: 0.85 }));
      const woodDark = mat(new THREE.MeshStandardMaterial({ color: 0x5a4632, roughness: 0.85 }));
      const red = mat(new THREE.MeshStandardMaterial({ color: 0x8a2f28, roughness: 0.7 }));
      // wooden platform the duel stands on
      const platform = box(11, 0.16, 11, wood, 0, 0.08, 0);
      platform.receiveShadow = true;
      floorY = 0.16;
      for (let i = -5; i <= 5; i++) {
        box(0.06, 0.02, 11, woodDark, i, 0.17, 0);
      }
      // torii gate
      cyl(0.2, 0.24, 3.4, red, -2.2, 1.7, -5.5);
      cyl(0.2, 0.24, 3.4, red, 2.2, 1.7, -5.5);
      box(5.6, 0.34, 0.42, red, 0, 3.5, -5.5);
      box(4.6, 0.26, 0.34, red, 0, 2.9, -5.5);
      // stone lanterns with warm windows
      const stone = mat(new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.95 }));
      const glow = mat(new THREE.MeshStandardMaterial({ color: 0xffd890, emissive: 0xffc060, emissiveIntensity: 1.8 }));
      for (const sx of [-1, 1]) {
        cyl(0.22, 0.3, 0.5, stone, sx * 3.4, 0.25, 2.6);
        box(0.4, 0.4, 0.4, stone, sx * 3.4, 0.72, 2.6);
        box(0.24, 0.24, 0.24, glow, sx * 3.4, 0.72, 2.6);
        box(0.56, 0.12, 0.56, stone, sx * 3.4, 1.0, 2.6);
        const l = new THREE.PointLight(0xffc060, 5, 6, 2);
        l.position.set(sx * 3.4, 0.9, 2.6);
        group.add(l);
      }
      // cherry tree
      const trunk = mat(new THREE.MeshStandardMaterial({ color: 0x4a3828, roughness: 0.95 }));
      const blossom = mat(new THREE.MeshStandardMaterial({ color: 0xe8a8b8, roughness: 0.9 }));
      const t = cyl(0.18, 0.3, 2.4, trunk, 4.2, 1.2, -3.6);
      t.rotation.z = -0.18;
      for (const [bx, by, bz, r] of [
        [4.0, 2.9, -3.6, 1.1],
        [3.3, 2.4, -3.2, 0.8],
        [4.7, 2.5, -4.0, 0.85],
      ] as const) {
        const blob = new THREE.Mesh(geo(new THREE.IcosahedronGeometry(r, 1)), blossom);
        blob.position.set(bx, by, bz);
        blob.castShadow = true;
        group.add(blob);
        const s0 = Math.random() * 5;
        updaters.push((dt, tt) => {
          blob.rotation.y = Math.sin(tt * 0.4 + s0) * 0.05;
        });
      }
      break;
    }
    case "neon": {
      const dark = mat(new THREE.MeshStandardMaterial({ color: 0x12141f, roughness: 0.5, metalness: 0.6 }));
      const glowC = mat(new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0x28e0ff, emissiveIntensity: 2 }));
      const glowM = mat(new THREE.MeshStandardMaterial({ color: 0x0a0a12, emissive: 0xff40c0, emissiveIntensity: 2 }));
      const grid = new THREE.GridHelper(80, 80, 0x1a3a5a, 0x0e1430);
      grid.position.y = 0.01;
      group.add(grid);
      // corner pillars with glowing cores
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          box(0.7, 6, 0.7, dark, sx * 5.5, 3, sz * 5.5);
          box(0.2, 5.6, 0.2, sx === sz ? glowC : glowM, sx * 5.5, 3, sz * 5.5);
        }
      }
      // floating halo ring
      const halo = new THREE.Mesh(geo(new THREE.TorusGeometry(3.4, 0.08, 8, 48)), glowC);
      halo.position.y = 5.2;
      halo.rotation.x = Math.PI / 2;
      group.add(halo);
      updaters.push((dt, t) => {
        halo.rotation.z = t * 0.15;
        halo.position.y = 5.2 + Math.sin(t * 0.8) * 0.25;
      });
      // floor light strips
      for (let i = -2; i <= 2; i++) {
        box(0.08, 0.02, 12, i % 2 === 0 ? glowC : glowM, i * 2.4, 0.02, 0);
      }
      break;
    }
  }

  // the dueling ring sits on top of whatever floor the era defined
  const ring = new THREE.Mesh(geo(new THREE.RingGeometry(3.3, 3.45, 48)), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = floorY + 0.02;
  group.add(ring);
  const ringInner = new THREE.Mesh(geo(new THREE.RingGeometry(0.55, 0.62, 32)), ringMat);
  ringInner.rotation.x = -Math.PI / 2;
  ringInner.position.y = floorY + 0.02;
  group.add(ringInner);

  /* ---------------------------- ambient particles ---------------------------- */
  const fieldColor =
    era.ambient === "petals" ? 0xf0b8c8 : era.ambient === "embers" ? 0xff9040 : era.ambient === "streaks" ? 0x40d8ff : 0xd8c8a0;
  const field = makeField(era.ambient, particleBudget, fieldColor);
  group.add(field.points);
  updaters.push((dt, t) => {
    const pos = field.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const { x: ax, y: ay, z: az } = field.area;
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] += (field.vel[i] + Math.sin(t * 0.8 + i + field.sway) * 0.15) * dt;
      arr[i + 1] += field.vel[i + 1] * dt;
      arr[i + 2] += (field.vel[i + 2] + Math.cos(t * 0.6 + i) * 0.1) * dt;
      if (arr[i + 1] < 0) arr[i + 1] += ay;
      if (arr[i + 1] > ay) arr[i + 1] -= ay;
      if (arr[i] > ax / 2) arr[i] -= ax;
      if (arr[i] < -ax / 2) arr[i] += ax;
      if (arr[i + 2] > az / 2) arr[i + 2] -= az;
      if (arr[i + 2] < -az / 2) arr[i + 2] += az;
    }
    pos.needsUpdate = true;
  });

  return {
    group,
    floorY,
    update(dt: number, t: number): void {
      for (const u of updaters) u(dt, t);
    },
    dispose(): void {
      for (const g of geoms) g.dispose();
      for (const m of mats) m.dispose();
      field.points.geometry.dispose();
      (field.points.material as THREE.Material).dispose();
      group.removeFromParent();
    },
  };
}
