/**
 * config.ts — global tuning. Input sensitivity and invert switches live here (sync verify-game.mjs when changing the mapping).
 * Also: era definitions (visuals + music) and gameplay tuning for the fencing duel.
 */

export const INPUT_CONFIG = {
  /** Mouse/touch camera sensitivity (radians/pixel). */
  MOUSE_SENS_X: 0.0026,
  MOUSE_SENS_Y: 0.0022,
  /** Camera invert switches: default false = mouse right turns camera right, mouse up looks up (intuitive directions). */
  INVERT_X: false,
  INVERT_Y: false,
} as const;

export const QUALITY = {
  /** Degradation tier for insufficient performance: cut particles and effects instead of dropping frames. */
  PARTICLES_HIGH: 500,
  PARTICLES_LOW: 150,
  /** Auto-degrade when the frame rate stays below this for 2s. */
  DEGRADE_FPS: 45,
} as const;

export const COLORS = {
  background: 0x0b0e12,
} as const;

/* ---------------------------------- eras ---------------------------------- */

export type EraId = "musketeer" | "knight" | "samurai" | "neon";
export const ERA_ORDER: EraId[] = ["musketeer", "knight", "samurai", "neon"];

export interface EraConfig {
  id: EraId;
  name: string;
  weapon: string;
  epithet: string;
  /** flat UI color used on title cards / HUD accents (css hex) */
  ui: string;
  sky: number;
  fogColor: number;
  fogNear: number;
  fogFar: number;
  hemiSky: number;
  hemiGround: number;
  sunColor: number;
  sunIntensity: number;
  ground: number;
  accent: number;
  ambient: "petals" | "embers" | "motes" | "streaks";
  blade: {
    length: number;
    width: number;
    thick: number;
    color: number;
    emissive: number;
    emissiveIntensity: number;
    kind: "rapier" | "longsword" | "katana" | "energy";
  };
  music: {
    bpm: number;
    /** semitone offsets from A2 (110 Hz) used by the generative sequencer */
    scale: number[];
    wave: OscillatorType;
    bassEvery: number; // steps (8th notes) between bass hits
    percussive: boolean;
  };
}

export const ERAS: Record<EraId, EraConfig> = {
  musketeer: {
    id: "musketeer",
    name: "Мушкетёр",
    weapon: "Рапира",
    epithet: "Двор замка, закат",
    ui: "#e0a34a",
    sky: 0x3a2140,
    fogColor: 0x4a2c40,
    fogNear: 14,
    fogFar: 46,
    hemiSky: 0x9a6a9a,
    hemiGround: 0x3a2a20,
    sunColor: 0xffb066,
    sunIntensity: 1.5,
    ground: 0x5a4632,
    accent: 0xd8a24a,
    ambient: "motes",
    blade: { length: 0.98, width: 0.02, thick: 0.02, color: 0xd8dde4, emissive: 0x000000, emissiveIntensity: 0, kind: "rapier" },
    music: { bpm: 96, scale: [0, 4, 7, 12, 16, 19, 24], wave: "triangle", bassEvery: 8, percussive: false },
  },
  knight: {
    id: "knight",
    name: "Рыцарь",
    weapon: "Палаш",
    epithet: "Замковый двор, ночь",
    ui: "#7a9ac0",
    sky: 0x0a0f1e,
    fogColor: 0x0d1424,
    fogNear: 12,
    fogFar: 40,
    hemiSky: 0x3a4a7a,
    hemiGround: 0x14100c,
    sunColor: 0x8fb0ff,
    sunIntensity: 0.7,
    ground: 0x2e2e34,
    accent: 0x8fa8c8,
    ambient: "embers",
    blade: { length: 1.05, width: 0.045, thick: 0.018, color: 0xc8ccd4, emissive: 0x000000, emissiveIntensity: 0, kind: "longsword" },
    music: { bpm: 66, scale: [0, 7, 12, 15], wave: "sawtooth", bassEvery: 16, percussive: false },
  },
  samurai: {
    id: "samurai",
    name: "Самурай",
    weapon: "Катана",
    epithet: "Сад на рассвете",
    ui: "#e06a7a",
    sky: 0xd8a8a0,
    fogColor: 0xe0b8b0,
    fogNear: 13,
    fogFar: 44,
    hemiSky: 0xffd8c8,
    hemiGround: 0x5a4a3a,
    sunColor: 0xffd8b0,
    sunIntensity: 1.2,
    ground: 0x7a6a58,
    accent: 0xd86a7a,
    ambient: "petals",
    blade: { length: 0.92, width: 0.03, thick: 0.015, color: 0xe4e8ee, emissive: 0x000000, emissiveIntensity: 0, kind: "katana" },
    music: { bpm: 84, scale: [0, 2, 3, 7, 8, 12], wave: "sine", bassEvery: 8, percussive: true },
  },
  neon: {
    id: "neon",
    name: "Неон",
    weapon: "Энергоклинок",
    epithet: "Арена будущего",
    ui: "#28e0ff",
    sky: 0x05060f,
    fogColor: 0x0a0a1e,
    fogNear: 12,
    fogFar: 42,
    hemiSky: 0x2a3a7a,
    hemiGround: 0x0a0a14,
    sunColor: 0x8090ff,
    sunIntensity: 0.6,
    ground: 0x0d0f1a,
    accent: 0x28e0ff,
    ambient: "streaks",
    blade: { length: 0.95, width: 0.035, thick: 0.035, color: 0x101018, emissive: 0x28e0ff, emissiveIntensity: 2.4, kind: "energy" },
    music: { bpm: 118, scale: [0, 3, 7, 10, 12, 15], wave: "square", bassEvery: 4, percussive: true },
  },
};

/* --------------------------------- tuning --------------------------------- */

export const TUNE = {
  /** hit points */
  HP: 100,
  /** player footwork */
  MOVE_SPEED: 2.6,
  STRAFE_LIMIT: 2.4,
  MIN_DIST: 1.35, // closest player can get to enemy
  MAX_DIST: 4.6,
  /** sword control */
  TIP_REACH: 1.8, // max distance shoulder -> tip target
  TIP_RATE: 17, // how fast the tip follows the mouse (1/s, exp smoothing)
  TIP_RATE_GUARD: 6.5, // while holding RMB (heavy guard)
  THRUST_TIME: 0.26,
  THRUST_EXTEND: 1.2,
  THRUST_RATE: 30,
  BLADE_PLANE: 1.5, // distance in front of the player where the mouse maps the tip
  /** hits */
  SLASH_MIN_SPEED: 3.4,
  HIT_COOLDOWN: 0.3,
  HIT_RADIUS: 0.4, // tip-to-body distance that counts as contact
  BLADE_BIND_RADIUS: 0.26, // tip-to-enemy-blade distance that counts as a bind/clang
  PARRY_RADIUS: 0.5,
  PARRY_RADIUS_GUARD: 0.82,
  RIPOSTE_MULT: 1.8,
  STAGGER_TIME: 1.15,
  ENEMY_STRIKE_REACH: 3.05,
  DODGE_X: 0.7, // sidestep farther than this from the intercept = the strike whiffs
  /** intro teaching phase: enemy only guards */
  INTRO_TIME: 9,
  COUNTDOWN_STEP: 0.6,
  /** enemy */
  ENEMY_HP: 100,
  ENEMY_SPEED: 1.9,
  ENEMY_HOLD_DIST: 2.7,
} as const;
