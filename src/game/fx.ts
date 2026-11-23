/**
 * fx.ts — pooled clash sparks + sword motion trails. Zero allocation after construction:
 * everything writes into preallocated Float32Arrays.
 */

import * as THREE from "three";

export class Sparks {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private col: Float32Array;
  private n: number;

  constructor(n = 160) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.col = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -999;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
    const m = new THREE.PointsMaterial({
      size: 0.055,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
  }

  spawn(at: THREE.Vector3, count: number, color: THREE.Color, speed = 3.4): void {
    let spawned = 0;
    for (let i = 0; i < this.n && spawned < count; i++) {
      if (this.life[i] > 0) continue;
      this.life[i] = this.maxLife[i] = 0.25 + Math.random() * 0.35;
      this.pos[i * 3] = at.x;
      this.pos[i * 3 + 1] = at.y;
      this.pos[i * 3 + 2] = at.z;
      // random cone burst, biased upward
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      const s = speed * (0.4 + Math.random() * 0.9);
      this.vel[i * 3] = Math.sin(ph) * Math.cos(th) * s;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(ph)) * s * 0.9;
      this.vel[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * s;
      this.col[i * 3] = color.r;
      this.col[i * 3 + 1] = color.g;
      this.col[i * 3 + 2] = color.b;
      spawned++;
    }
  }

  update(dt: number): void {
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.pos[i * 3 + 1] = -999;
        continue;
      }
      this.vel[i * 3 + 1] -= 9.8 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = this.life[i] / this.maxLife[i];
      // fade by shrinking color toward black (additive blending => fades out)
      const base = 0.3 + 0.7 * f;
      this.col[i * 3] *= base > 0.92 ? 1 : 0.98;
      this.col[i * 3 + 1] *= base > 0.92 ? 1 : 0.98;
      this.col[i * 3 + 2] *= base > 0.92 ? 1 : 0.98;
    }
    if (any) {
      (this.points.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
      (this.points.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    this.points.removeFromParent();
  }
}

/** Ribbon trail following the blade: a fixed ring buffer of hilt/tip pairs drawn as a fading strip. */
export class Trail {
  readonly mesh: THREE.Mesh;
  private readonly N = 16;
  private tip: Float32Array;
  private hilt: Float32Array;
  private head = 0;
  private filled = 0;
  private positions: Float32Array;
  private colors: Float32Array;
  private active = false;
  private baseColor: THREE.Color;

  constructor(color: number) {
    this.tip = new Float32Array(this.N * 3);
    this.hilt = new Float32Array(this.N * 3);
    this.positions = new Float32Array(this.N * 2 * 3);
    this.colors = new Float32Array(this.N * 2 * 4);
    this.baseColor = new THREE.Color(color);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.positions, 3));
    g.setAttribute("color", new THREE.BufferAttribute(this.colors, 4));
    const idx: number[] = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
  }

  setColor(color: number): void {
    this.baseColor.set(color);
  }

  /** feed the current blade pose; active=false fades the ribbon out */
  push(tip: THREE.Vector3, hilt: THREE.Vector3, active: boolean): void {
    if (active) {
      if (!this.active) {
        // (re)start: seed the whole ribbon at the current pose so it does not streak from stale points
        for (let i = 0; i < this.N; i++) {
          this.tip[i * 3] = tip.x;
          this.tip[i * 3 + 1] = tip.y;
          this.tip[i * 3 + 2] = tip.z;
          this.hilt[i * 3] = hilt.x;
          this.hilt[i * 3 + 1] = hilt.y;
          this.hilt[i * 3 + 2] = hilt.z;
        }
        this.filled = this.N;
      }
      this.head = (this.head + 1) % this.N;
      this.tip[this.head * 3] = tip.x;
      this.tip[this.head * 3 + 1] = tip.y;
      this.tip[this.head * 3 + 2] = tip.z;
      this.hilt[this.head * 3] = hilt.x;
      this.hilt[this.head * 3 + 1] = hilt.y;
      this.hilt[this.head * 3 + 2] = hilt.z;
    } else if (this.active) {
      this.filled = 0; // blade slowed down: drop the ribbon instantly
    }
    this.active = active;
    this.rebuild();
  }

  private rebuild(): void {
    const visible = this.active && this.filled >= 2;
    for (let i = 0; i < this.N; i++) {
      // i = 0 oldest … N-1 newest
      const src = visible ? (this.head + 1 + i) % this.N : this.head;
      const fade = visible ? Math.pow(i / (this.N - 1), 1.6) * 0.55 : 0;
      const v = i * 2;
      this.positions[v * 3] = this.tip[src * 3];
      this.positions[v * 3 + 1] = this.tip[src * 3 + 1];
      this.positions[v * 3 + 2] = this.tip[src * 3 + 2];
      this.positions[(v + 1) * 3] = this.hilt[src * 3];
      this.positions[(v + 1) * 3 + 1] = this.hilt[src * 3 + 1];
      this.positions[(v + 1) * 3 + 2] = this.hilt[src * 3 + 2];
      this.colors[v * 4] = this.baseColor.r;
      this.colors[v * 4 + 1] = this.baseColor.g;
      this.colors[v * 4 + 2] = this.baseColor.b;
      this.colors[v * 4 + 3] = fade;
      this.colors[(v + 1) * 4] = this.baseColor.r;
      this.colors[(v + 1) * 4 + 1] = this.baseColor.g;
      this.colors[(v + 1) * 4 + 2] = this.baseColor.b;
      this.colors[(v + 1) * 4 + 3] = fade * 0.6;
    }
    (this.mesh.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute("color") as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.removeFromParent();
  }
}
