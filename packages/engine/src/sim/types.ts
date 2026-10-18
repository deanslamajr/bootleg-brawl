// Integer ids used inside the sim. Content strings are mapped to these once at compile time.

export const TICK_HZ = 60;
export const VIEW_W = 480;
export const VIEW_H = 270;
export const MAX_ENTITIES = 256;
export const MAX_PLAYERS = 4;
export const MAX_ON_SCREEN_ENEMIES = 14;

/** Raw input bits, one InputFrame per player per tick. */
export const IN = {
  UP: 1,
  DOWN: 2,
  LEFT: 4,
  RIGHT: 8,
  ATTACK: 16,
  JUMP: 32,
  SPECIAL: 64,
  TAUNT: 128,
  START: 256,
  /** Dedicated run button (gamepad RB): same as a double-tap. */
  DASH: 512,
} as const;
export type InputFrame = number;

export const KIND = {
  none: 0,
  player: 1,
  enemy: 2,
  boss: 3,
  projectile: 4,
  pickup: 5,
  prop: 6,
  civilian: 7,
  actor: 8,
  hazard: 9,
} as const;
export type EntityKind = (typeof KIND)[keyof typeof KIND];

export const TEAM = { players: 0, enemies: 1, neutral: 2, hazards: 3 } as const;

export const STATE_KINDS = [
  "free",
  "air",
  "attack",
  "special",
  "grab",
  "grabbed",
  "throw",
  "thrown",
  "hurt",
  "fall",
  "down",
  "getup",
  "ko",
  "pickup",
  "teamup",
  "taunt",
  "stomp",
  "misc",
] as const;
export const SK = Object.fromEntries(STATE_KINDS.map((k, i) => [k, i])) as Record<
  (typeof STATE_KINDS)[number],
  number
>;

export const COMMANDS = [
  "attack",
  "attackHeld",
  "attackRelease",
  "jump",
  "special",
  "specialF",
  "specialB",
  "specialU",
  "specialD",
  "back",
  "dash",
  "dashAttack",
  "airAttack",
  "dive",
  "stomp",
  "pickup",
  "throwF",
  "throwB",
  "throwCam",
  "grabHit",
  "taunt",
  "teamup",
  "land",
  "chargeRelease",
  "any",
  // Appended last so the earlier command bits keep their values.
  "drop",
] as const;
export type CommandName = (typeof COMMANDS)[number];
export const CMD = Object.fromEntries(COMMANDS.map((k, i) => [k, 1 << i])) as Record<
  CommandName,
  number
>;
/** Commands that count as "any" for transitions listening to any action. */
export const CMD_ANY_MASK =
  CMD.attack |
  CMD.jump |
  CMD.special |
  CMD.back |
  CMD.dash |
  CMD.taunt |
  CMD.drop |
  CMD.specialF |
  CMD.specialB |
  CMD.specialU |
  CMD.specialD;

export const CONDITIONS = [
  "none",
  "hasWeapon",
  "noWeapon",
  "hasImprovised",
  "noImprovised",
  "grabCount<2",
  "grabCount>=2",
  "inAir",
  "onGround",
  "charged",
] as const;
export const COND = Object.fromEntries(CONDITIONS.map((k, i) => [k, i])) as Record<
  (typeof CONDITIONS)[number],
  number
>;

/** Entity flag bits (component `flags`). */
export const F = {
  miniBoss: 1,
  boss: 2,
  civilian: 4,
  hidden: 8,
  invulnerable: 16,
  light: 32,
  grabbable: 64,
  thrownBody: 128,
  noGravity: 256,
  offscreenOk: 512,
  teamFly: 1024,
  dizzy: 2048,
  emerging: 4096,
  camFly: 8192,
  lockEnemy: 16384,
  firstEnemy: 32768,
  unfightable: 65536,
  towing: 131072,
  /** Set once an enemy has walked into view; it then stays on screen during locks. */
  entered: 262144,
} as const;

export const PHASE = {
  intro: 0,
  play: 1,
  bossIntro: 2,
  boss: 3,
  bossDown: 4,
  outro: 5,
  clear: 6,
  gameover: 7,
  segmentFade: 8,
} as const;

export const SLOT = { empty: 0, picking: 1, playing: 2, continue: 3, out: 4 } as const;

export const DIFFICULTY = {
  casual: { damageTakenPct: 70, credits: -1, tierShift: -1, lives: 3 },
  arcade: { damageTakenPct: 100, credits: 6, tierShift: 0, lives: 3 },
  "1-credit": { damageTakenPct: 120, credits: 0, tierShift: 1, lives: 2 },
} as const;
export type Difficulty = keyof typeof DIFFICULTY;

export type FriendlyFire = "off" | "weapons" | "chaos";

/** Gravity in 16.16 px/tick^2. */
export const GRAVITY = 21000;
