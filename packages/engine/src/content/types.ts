// Raw (validated) content as loaded from bundles or the repo, and the compiled runtime tables.

import type {
  ArenaFile,
  BossFile,
  CampaignFile,
  CharacterFile,
  EnemyFamilyFile,
  InterludeFile,
  ItemsFile,
  LayerFile,
  LinePools,
  OverlaysFile,
  RigFile,
  RosterFile,
  SegmentFile,
  SfxFile,
  SpeechSettings,
  StageFile,
  StatesFile,
  TrackFile,
} from "@bb/schema";

export interface ActorSource<F> {
  file: F;
  states: StatesFile;
  overlays: OverlaysFile;
  /** The folder's lines.json, pool name to lines (D80). */
  lines?: LinePools;
}

export interface StageSource {
  file: StageFile;
  segments: Record<string, SegmentFile>;
  layers: Record<string, LayerFile>;
  lines?: LinePools;
}

export interface RawContent {
  rigs: Record<string, RigFile>;
  templates: Record<string, StatesFile>;
  palettes: Record<string, string[]>;
  masterPalette: string[];
  items: ItemsFile;
  characters: Record<string, ActorSource<CharacterFile>>;
  enemies: Record<string, ActorSource<EnemyFamilyFile>>;
  bosses: Record<string, ActorSource<BossFile>>;
  arenas: Record<string, ArenaFile>;
  stages: Record<string, StageSource>;
  interludes: Record<string, InterludeFile>;
  campaign: CampaignFile;
  roster: RosterFile;
  sfx: SfxFile;
  tracks: Record<string, TrackFile>;
  forbiddenTerms: string[];
  /** Feature flags this build turns on (content/settings.json). */
  flags: string[];
  /** How often the game screen shows lines (content/settings.json). */
  speech: SpeechSettings;
}

export interface CBox {
  x: number;
  z: number;
  w: number;
  h: number;
}

export interface CHit {
  box: CBox;
  damage: number;
  kx: number;
  kz: number;
  hitstop: number;
  hitstun: number;
  knockdown: boolean;
  launch: boolean;
  grab: boolean;
  rehit: number;
  sfx: string;
  score: number;
  tags: string[];
  ground: boolean;
}

export interface CEvent {
  at: number;
  sfx?: string;
  spawn?: { projectile: number; ox: number; oz: number; vx: number; vz: number };
  shake?: number;
  release?: boolean;
  text?: string;
  flash?: boolean;
  signal?: string;
}

export interface CFrame {
  start: number;
  dur: number;
  pose: string;
  hit: CHit[];
  hurt: CBox[];
  velX: number | null;
  velZ: number | null;
  events: CEvent[];
}

export interface CTransition {
  cmd: number;
  to: number;
  from: number;
  until: number;
  cond: number;
}

export interface CState {
  id: number;
  name: string;
  kind: number;
  loop: boolean;
  frames: CFrame[];
  total: number;
  /** Frame index per tick, length = total. */
  frameAt: Uint8Array;
  next: number;
  transitions: CTransition[];
  move: number;
  moveY: boolean;
  facingLock: boolean;
  gravity: boolean;
  landTo: number;
  armor: number;
  invulnFrom: number;
  invulnTo: number;
  costHp: number;
  costOnHit: boolean;
  friction: number;
  tags: string[];
  hasHit: boolean;
}

/** Well-known state ids every actor may have; -1 when missing. */
export interface StateIds {
  idle: number;
  walk: number;
  run: number;
  jump: number;
  land: number;
  hurt: number;
  hurtAir: number;
  fall: number;
  down: number;
  getup: number;
  ko: number;
  grab: number;
  grabbed: number;
  thrown: number;
  pickup: number;
  taunt: number;
  teamPartnerToss: number;
  teamFly: number;
  teamCloud: number;
  dizzy: number;
  emerge: number;
  camFly: number;
  grabHit: number;
  throwF: number;
  throwB: number;
  victory: number;
  sleep: number;
  dead: number;
}

export type DefKind = "player" | "enemy" | "boss" | "projectile" | "pickup" | "prop" | "actor";

export interface CTier {
  name: string;
  displayName: string;
  palette: string;
  hp: number;
  damagePct: number;
  speedPct: number;
  moves: number[];
  badge?: string;
  miniBoss: boolean;
  score: number;
  aggression: number;
}

export interface CDef {
  index: number;
  id: string;
  kind: DefKind;
  displayName: string;
  /** Sprite sheet id the renderer looks up. */
  sheet: string;
  palette: string;
  rig: string;
  /** Unit-space to pixel scale, percent. */
  scalePct: number;
  states: CState[];
  stateIndex: Record<string, number>;
  S: StateIds;
  hp: number;
  walk: number;
  walkY: number;
  runSpeed: number;
  jumpVel: number;
  weightPct: number;
  damagePct: number;
  shadowPct: number;
  pushW: number;
  sfx: Record<string, string>;
  player?: CPlayer;
  enemy?: CEnemy;
  boss?: CBoss;
  projectile?: CProjectile;
  pickup?: CPickup;
  prop?: CProp;
}

export interface CPlayer {
  shortName: string;
  archetype: string;
  specialCost: number;
  teamUps: { partner: string; state: number; displayName: string; both: boolean }[];
  improvised?: { id: string; name: string; hits: number; respawn: number; breakText?: string };
  gags: string[];
  requires: string[];
  kit: Record<string, unknown>;
  voice: CharacterFile["voice"];
  /** Line pool indices: taunt, continue, ending, select. -1 when a pool is empty. */
  pools: Record<string, number>;
  portrait: string;
  unlock: string;
}

export interface CEnemy {
  family: string;
  tiers: CTier[];
  ai: EnemyFamilyFile["ai"]["kind"];
  aiParams: EnemyFamilyFile["ai"]["params"];
  attackStates: number[];
  rangedState: number;
  chargeState: number;
  light: boolean;
  grabbable: boolean;
  weapon: number;
  civilian?: { penalty: number; rescueDrop: number };
  /** Line pool indices: ko, spawn, help, rescue. -1 when a pool is empty. */
  pools: Record<string, number>;
  catalogType: string[];
}

export interface CBoss {
  file: BossFile;
  phases: BossFile["phases"];
  gimmicks: Map<string, Record<string, unknown>>;
  guardPct: number;
  poise: number;
  partner: string;
  card: BossFile["card"];
  defeat: BossFile["defeat"];
  /** Line pool indices: pattern, hurt, defeat, card, phase, defeatBanner. -1 when empty. */
  pools: Record<string, number>;
}

export interface CProjectile {
  speed: number;
  damage: number;
  kx: number;
  kz: number;
  hitstop: number;
  hitstun: number;
  knockdown: boolean;
  lifetime: number;
  pierce: number;
  gravity: number;
  box: CBox;
  sfx: string;
  tags: string[];
  dropsPickup: number;
  spin: boolean;
  scalePct: number;
}

export interface CPickup {
  kind: "food" | "weapon" | "coin" | "ammo" | "potion" | "credit" | "mascot";
  heal: number;
  score: number;
  weapon: number;
  lifetime: number;
  text?: string;
}

export interface CProp {
  hp: number;
  breakable: boolean;
  hurt: CBox;
  drops: { item: number; weight: number }[];
  score: number;
  breakSfx: string;
  spawner: boolean;
}

export interface CWeapon {
  index: number;
  id: string;
  displayName: string;
  hits: number;
  moveset: "swing" | "stab" | "heavy";
  damage: number;
  reach: number;
  sheet: string;
  pickup: number;
  breakText: string;
  throwProjectile: number;
}

export interface CompiledContent {
  raw: RawContent;
  defs: CDef[];
  defIndex: Record<string, number>;
  weapons: CWeapon[];
  weaponIndex: Record<string, number>;
  /** Player character def indices in select-screen order. */
  roster: number[];
  /** Every line pool. The sim names a pool by its index; the game screen picks the line (D80). */
  lines: CLinePool[];
  /** Stage id to pool name to pool index: costume, bulletin, outro, outroBanner, announcer. */
  stagePools: Record<string, Record<string, number>>;
  hash: string;
}

export interface CLinePool {
  /** Stable name for the seen-line memory, such as "enemy/interns/ko". */
  key: string;
  /** The pool name, such as "ko". The line book's chance and gap rules key on it. */
  role: string;
  lines: string[];
  /** Paired lines at the same index (the announcer's line and Mensa's correction). */
  pair?: string[];
}
