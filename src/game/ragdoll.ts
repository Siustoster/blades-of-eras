/**
 * ragdoll.ts — real rigid-body ragdoll (Rapier) for the defeated duelist + a flying sword.
 * Spawned at game over: the procedural rig is hidden and replaced by jointed bodies that
 * get an impulse away from the winner, collapse, and settle. Zero allocation after creation.
 */

import RAPIER from "@dimforge/rapier3d-compat";
import * as THREE from "three";

export interface RagdollPalette {
  body: number;
  trim: number;
  head: number;
  dark: number;
}

interface Part {
  body: RAPIER.RigidBody;
  mesh: THREE.Mesh;
}

const STEP = 1 / 60;

export class Ragdoll {
  readonly group = new THREE.Group();
  private world: RAPIER.World;
  private parts: Part[] = [];
  private swordBody: RAPIER.RigidBody;
  private swordMesh: THREE.Group;
  private geoms: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private acc = 0;
  private age = 0;
  private settled = false;

  constructor(
    origin: THREE.Vector3,
    floorY: number,
    impulse: THREE.Vector3,
    palette: RagdollPalette,
    bladeColor: number,
    bladeGlow: number,
  ) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    // ground
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(40, 0.1, 40).setTranslation(0, floorY - 0.1, 0).setFriction(0.9),
    );

    const mk = (
      kind: "box" | "ball",
      size: [number, number, number] | number,
      lx: number, ly: number, lz: number,
      color: number,
    ): Part => {
      const body = this.world.createRigidBody(
        RAPIER.RigidBodyDesc.dynamic().setTranslation(origin.x + lx, floorY + ly, origin.z + lz),
      );
      let geo: THREE.BufferGeometry;
      if (kind === "box") {
        const [hx, hy, hz] = size as [number, number, number];
        this.world.createCollider(
          RAPIER.ColliderDesc.cuboid(hx, hy, hz).setFriction(0.8).setRestitution(0.15),
          body,
        );
        geo = new THREE.BoxGeometry(hx * 2, hy * 2, hz * 2);
      } else {
        const r = size as number;
        this.world.createCollider(RAPIER.ColliderDesc.ball(r).setFriction(0.8).setRestitution(0.2), body);
        geo = new THREE.SphereGeometry(r, 12, 10);
      }
      this.geoms.push(geo);
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.15 });
      this.mats.push(m);
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = true;
      mesh.position.set(origin.x + lx, floorY + ly, origin.z + lz);
      this.group.add(mesh);
      const part = { body, mesh };
      this.parts.push(part);
      return part;
    };

    // body layout mirrors the procedural rig's proportions
    const pelvis = mk("box", [0.16, 0.1, 0.11], 0, 0.98, 0, palette.dark);
    const torso = mk("box", [0.17, 0.29, 0.13], 0, 1.3, 0, palette.body);
    const head = mk("ball", 0.14, 0, 1.78, 0, palette.head);
    const uArmL = mk("box", [0.06, 0.17, 0.06], 0.3, 1.28, 0, palette.body);
    const uArmR = mk("box", [0.06, 0.17, 0.06], -0.3, 1.28, 0, palette.body);
    const fArmL = mk("box", [0.05, 0.17, 0.05], 0.33, 0.94, 0, palette.body);
    const fArmR = mk("box", [0.05, 0.17, 0.05], -0.33, 0.94, 0, palette.body);
    const thighL = mk("box", [0.085, 0.22, 0.085], 0.13, 0.74, 0, palette.dark);
    const thighR = mk("box", [0.085, 0.22, 0.085], -0.13, 0.74, 0, palette.dark);
    const shinL = mk("box", [0.07, 0.22, 0.07], 0.13, 0.3, 0, palette.dark);
    const shinR = mk("box", [0.07, 0.22, 0.07], -0.13, 0.3, 0, palette.dark);

    const link = (a: Part, b: Part, wx: number, wy: number, wz: number) => {
      const pa = a.body.translation();
      const pb = b.body.translation();
      const jd = RAPIER.JointData.spherical(
        { x: wx - pa.x, y: wy - pa.y, z: wz - pa.z },
        { x: wx - pb.x, y: wy - pb.y, z: wz - pb.z },
      );
      this.world.createImpulseJoint(jd, a.body, b.body, true);
    };
    link(pelvis, torso, 0, floorY + 1.12, 0);
    link(torso, head, 0, floorY + 1.68, 0);
    link(torso, uArmL, 0.26, floorY + 1.52, 0);
    link(torso, uArmR, -0.26, floorY + 1.52, 0);
    link(uArmL, fArmL, 0.315, floorY + 1.11, 0);
    link(uArmR, fArmR, -0.315, floorY + 1.11, 0);
    link(pelvis, thighL, 0.13, floorY + 0.96, 0);
    link(pelvis, thighR, -0.13, floorY + 0.96, 0);
    link(thighL, shinL, 0.13, floorY + 0.52, 0);
    link(thighR, shinR, -0.13, floorY + 0.52, 0);

    // the kill impulse: shove the torso/pelvis away from the winner, slight upward pop + spin.
    // NOTE: collider volumes are ~0.05 m³, so masses are ~0.05 — impulses must scale with mass
    // (impulse = mass × desired Δv), otherwise the body launches into orbit.
    for (const p of [torso, pelvis, head]) {
      const m = p.body.mass();
      p.body.applyImpulse({ x: impulse.x * m, y: impulse.y * m, z: impulse.z * m }, true);
      p.body.applyTorqueImpulse(
        {
          x: (Math.random() - 0.5) * 0.6 * m,
          y: (Math.random() - 0.5) * 0.6 * m,
          z: (Math.random() - 0.5) * 0.6 * m,
        },
        true,
      );
    }

    // the sword leaves the hand and flies
    this.swordBody = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(origin.x, floorY + 1.2, origin.z + 0.4)
        .setLinvel(impulse.x * 1.2 + (Math.random() - 0.5), 2.6 + Math.random(), impulse.z * 1.2 + (Math.random() - 0.5))
        .setAngvel({ x: 4 + Math.random() * 4, y: Math.random() * 3, z: 2 + Math.random() * 3 }),
    );
    this.world.createCollider(
      RAPIER.ColliderDesc.cuboid(0.03, 0.5, 0.02).setFriction(0.6).setRestitution(0.35),
      this.swordBody,
    );
    const bladeGeo = new THREE.BoxGeometry(0.05, 1.0, 0.02);
    const guardGeo = new THREE.BoxGeometry(0.2, 0.05, 0.05);
    this.geoms.push(bladeGeo, guardGeo);
    const bladeMat = new THREE.MeshStandardMaterial({
      color: bladeColor,
      metalness: 0.9,
      roughness: 0.3,
      emissive: bladeGlow,
      emissiveIntensity: bladeGlow ? 1.8 : 0,
    });
    this.mats.push(bladeMat);
    this.swordMesh = new THREE.Group();
    this.swordMesh.add(new THREE.Mesh(bladeGeo, bladeMat));
    const guard = new THREE.Mesh(guardGeo, bladeMat);
    guard.position.y = -0.52;
    this.swordMesh.add(guard);
    this.swordMesh.children.forEach((c) => ((c as THREE.Mesh).castShadow = true));
    this.group.add(this.swordMesh);
  }

  /** step physics at a fixed rate and sync meshes; auto-freezes once settled */
  update(dt: number): void {
    if (!this.settled) {
      this.acc = Math.min(this.acc + dt, 0.1);
      while (this.acc >= STEP) {
        this.world.step();
        this.acc -= STEP;
      }
      this.age += dt;
      if (this.age > 4) {
        this.settled = true; // stop paying for physics once the bodies rest
      }
    }
    for (const p of this.parts) {
      const t = p.body.translation();
      const r = p.body.rotation();
      p.mesh.position.set(t.x, t.y, t.z);
      p.mesh.quaternion.set(r.x, r.y, r.z, r.w);
    }
    const t = this.swordBody.translation();
    const r = this.swordBody.rotation();
    this.swordMesh.position.set(t.x, t.y, t.z);
    this.swordMesh.quaternion.set(r.x, r.y, r.z, r.w);
  }

  dispose(): void {
    this.world.free();
    for (const g of this.geoms) g.dispose();
    for (const m of this.mats) m.dispose();
    this.group.removeFromParent();
  }
}

/** init Rapier WASM once, ahead of time */
let rapierInit: Promise<unknown> | null = null;
export function warmupRapier(): void {
  if (!rapierInit) rapierInit = RAPIER.init();
}
export function rapierReady(): boolean {
  return rapierInit !== null;
}
export function whenRapierReady(): Promise<unknown> {
  warmupRapier();
  return rapierInit!;
}
