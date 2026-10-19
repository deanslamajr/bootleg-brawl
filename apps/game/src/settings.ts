// Options and the local run save. Everything here is per-browser; a missing or blocked
// localStorage just means defaults and no save.

import type { Difficulty, FriendlyFire } from "@bb/engine";

/** The on-screen pad: shown by the device rules, always, or never. */
export type TouchControls = "auto" | "on" | "off";
export const TOUCH_CONTROLS: TouchControls[] = ["auto", "on", "off"];

export interface Settings {
  difficulty: Difficulty;
  friendlyFire: FriendlyFire;
  cabinetMode: boolean;
  musicVolume: number;
  sfxVolume: number;
  gore: boolean;
  touchControls: TouchControls;
}

const SETTINGS_KEY = "bootleg-brawl.settings.v1";
const RUN_KEY = "bootleg-brawl.run.v1";

export const DEFAULT_SETTINGS: Settings = {
  difficulty: "arcade",
  friendlyFire: "off",
  cabinetMode: false,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  gore: false,
  touchControls: "auto",
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not persisted */
  }
}

export function loadSettings(): Settings {
  return { ...DEFAULT_SETTINGS, ...(read<Partial<Settings>>(SETTINGS_KEY) ?? {}) };
}

export function saveSettings(s: Settings): void {
  write(SETTINGS_KEY, s);
}

/** Serializable run progress: what persists between stages and interludes. */
export interface RunState {
  version: 1;
  seed: number;
  /** Character id per player slot ("" when the slot is empty). */
  party: string[];
  scores: number[];
  lives: number[];
  credits: number;
  difficulty: Difficulty;
  friendlyFire: FriendlyFire;
  cabinetMode: boolean;
  /** The stage to play next and the queue of interludes before it. */
  stageId: string;
  queue: string[];
  cleared: string[];
}

export function loadRun(): RunState | null {
  const r = read<RunState>(RUN_KEY);
  return r && r.version === 1 ? r : null;
}

export function saveRun(r: RunState | null): void {
  write(RUN_KEY, r);
}
