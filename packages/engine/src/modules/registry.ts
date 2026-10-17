// Mechanic modules add components, systems and schema fragments. They never patch core systems.

import type { SchemaFragments } from "@bb/schema";
import type { ComponentDef } from "../ecs/world";
import type { CHit } from "../content/types";
import type { Sim, SimEvent } from "../sim/sim";

export const PHASES = [
  "input",
  "ai",
  "movement",
  "collision",
  "combat",
  "state",
  "animation",
  "events",
] as const;
export type Phase = (typeof PHASES)[number];

export interface SystemDef {
  phase: Phase;
  /** Core systems use multiples of 10 from 0 to 100. */
  order: number;
  name: string;
  run(sim: Sim): void;
}

export interface SpawnRequest {
  def: number;
  tier: number;
  x: number;
  y: number;
  side: number;
  kind: string;
}

/** A segment controller runs a segment kind's progression (scroll locks, elevator floors). */
export interface SegmentController {
  start(sim: Sim): void;
  /** Returns true when the segment is finished. */
  tick(sim: Sim): boolean;
}

export interface ModuleHooks {
  onStageLoad?(sim: Sim): void;
  onSegmentStart?(sim: Sim, index: number): void;
  onCharacterLoad?(sim: Sim, e: number): void;
  onEntitySpawn?(sim: Sim, e: number): void;
  onRunEvent?(sim: Sim, ev: SimEvent): void;
  /** Adds commands after the core parser ran for a player or AI entity this tick. */
  onCommands?(sim: Sim, e: number, pressed: number, held: number, released: number): void;
  /** Return true to cancel the hit. */
  onHit?(sim: Sim, attacker: number, target: number, hit: CHit): boolean | void;
  onSignal?(sim: Sim, e: number, signal: string): void;
  /** Return true when the module handled the throw release. */
  onRelease?(sim: Sim, grabber: number, victim: number, stateName: string): boolean | void;
  onBossStart?(sim: Sim, bosses: number[], arenaId: string | undefined): void;
  onBossEnd?(sim: Sim): void;
  /** Return true when the module ran the boss gimmick step. */
  onGimmick?(sim: Sim, boss: number, gimmick: string, tick: number): boolean | void;
}

export interface SandboxScene {
  title: string;
  stage?: string;
  segment?: number;
  characters: string[];
  dummies?: { family: string; tier: number; x: number; y: number }[];
  flags?: string[];
}

export interface MechanicModule {
  id: string;
  version: number;
  /** Feature flag. Off until the module's tests pass; content requiring it then fails validation. */
  flag: string;
  /** Flag state when no override is given. */
  defaultOn: boolean;
  components?: ComponentDef[];
  systems?: SystemDef[];
  schema?: SchemaFragments;
  assets?: string[];
  hooks?: ModuleHooks;
  /** Spawn kinds the module provides (manhole, dumpster...). Returns the entity or -1. */
  spawnKinds?: Record<string, (sim: Sim, req: SpawnRequest) => number>;
  /** AI kinds the module provides. */
  aiKinds?: Record<string, (sim: Sim, e: number) => void>;
  /** Segment kinds or segment field names the module controls. */
  segmentControllers?: Record<string, () => SegmentController>;
  /** Movement providers for entities that carry the module's component. */
  movementProviders?: Record<string, (sim: Sim, e: number) => boolean>;
  sandboxScene?: () => SandboxScene;
}

export class ModuleRegistry {
  private readonly modules = new Map<string, MechanicModule>();
  private readonly enabledFlags = new Set<string>();
  private readonly disabledFlags = new Set<string>();

  register(m: MechanicModule): this {
    if (this.modules.has(m.id)) throw new Error(`module ${m.id} registered twice`);
    this.modules.set(m.id, m);
    return this;
  }

  /** Flags from settings.json or the URL (?flags=mech.elevator,-mech.autoScroll). */
  setFlags(flags: readonly string[]): this {
    for (const f of flags) {
      if (f.startsWith("-")) this.disabledFlags.add(f.slice(1));
      else this.enabledFlags.add(f);
    }
    return this;
  }

  get(id: string): MechanicModule | undefined {
    return this.modules.get(id);
  }

  all(): MechanicModule[] {
    return [...this.modules.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  isOn(id: string): boolean {
    const m = this.modules.get(id);
    if (!m) return false;
    if (this.disabledFlags.has(m.flag)) return false;
    return m.defaultOn || this.enabledFlags.has(m.flag);
  }

  enabled(): MechanicModule[] {
    return this.all().filter((m) => this.isOn(m.id));
  }

  /** Names every required module that is missing or flagged off. */
  missing(requires: readonly string[]): string[] {
    return requires
      .filter((r) => !this.isOn(r))
      .map((r) =>
        this.modules.has(r)
          ? `${r} (flag ${this.modules.get(r)!.flag} is off)`
          : `${r} (not registered)`,
      );
  }

  schemaFragments(): SchemaFragments[] {
    return this.all()
      .map((m) => m.schema)
      .filter((s): s is SchemaFragments => !!s);
  }
}
