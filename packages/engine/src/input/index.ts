// Input: two keyboard layouts plus any number of gamepads, polled once per sim tick into one
// InputFrame per player slot. Devices are assigned to slots on first input. The action map is
// remappable and stored in the browser.

import { IN, type InputFrame } from "../sim/types";

export type Action =
  | "up"
  | "down"
  | "left"
  | "right"
  | "attack"
  | "jump"
  | "special"
  | "taunt"
  | "start"
  | "dash";
export const ACTIONS: Action[] = [
  "up",
  "down",
  "left",
  "right",
  "attack",
  "jump",
  "special",
  "taunt",
  "start",
  "dash",
];
const BIT: Record<Action, number> = {
  up: IN.UP,
  down: IN.DOWN,
  left: IN.LEFT,
  right: IN.RIGHT,
  attack: IN.ATTACK,
  jump: IN.JUMP,
  special: IN.SPECIAL,
  taunt: IN.TAUNT,
  start: IN.START,
  dash: IN.DASH,
};

export type KeyMap = Record<Action, string[]>;

export const DEFAULT_KEYS: KeyMap[] = [
  {
    up: ["KeyW"],
    down: ["KeyS"],
    left: ["KeyA"],
    right: ["KeyD"],
    attack: ["KeyJ"],
    jump: ["KeyK"],
    special: ["KeyU"],
    taunt: ["KeyL"],
    start: ["Enter"],
    dash: ["KeyI"],
  },
  {
    up: ["ArrowUp"],
    down: ["ArrowDown"],
    left: ["ArrowLeft"],
    right: ["ArrowRight"],
    attack: ["Numpad1", "Comma"],
    jump: ["Numpad2", "Period"],
    special: ["Numpad4", "Semicolon"],
    taunt: ["Numpad3", "Slash"],
    start: ["NumpadEnter", "ShiftRight"],
    dash: ["Numpad5", "Quote"],
  },
];

/** Standard-mapping gamepad buttons per action. */
export const DEFAULT_PAD: Record<Action, number[]> = {
  up: [12],
  down: [13],
  left: [14],
  right: [15],
  attack: [2],
  jump: [0],
  special: [3],
  taunt: [1],
  start: [9],
  dash: [5],
};

const STORAGE_KEY = "bootleg-brawl.keys.v1";

type Device = { kind: "kb"; layout: number } | { kind: "pad"; index: number };

export class InputManager {
  private readonly down = new Set<string>();
  /** Keys pressed since the last sample, so a tap shorter than one tick still registers. */
  private readonly tapped = new Set<string>();
  keys: KeyMap[];
  pad = DEFAULT_PAD;
  /** Slot -> device. */
  readonly slots: (Device | null)[] = [null, null, null, null];
  /** Inputs injected by tests (window.__bootleg) override devices for a slot when set. */
  readonly injected: (number | null)[] = [null, null, null, null];
  private prev: InputFrame[] = [0, 0, 0, 0];
  private cur: InputFrame[] = [0, 0, 0, 0];
  maxSlots = 4;
  enabled = true;

  constructor(private readonly target: Window = window) {
    this.keys = this.loadKeys();
    target.addEventListener("keydown", (e) => {
      if (!this.enabled) return;
      if (this.isBound(e.code)) e.preventDefault();
      this.down.add(e.code);
      if (!e.repeat) this.tapped.add(e.code);
    });
    target.addEventListener("keyup", (e) => this.down.delete(e.code));
    target.addEventListener("blur", () => this.down.clear());
  }

  private loadKeys(): KeyMap[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as KeyMap[];
    } catch {
      // Private mode or blocked storage: defaults.
    }
    return structuredClone(DEFAULT_KEYS);
  }

  saveKeys(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.keys));
    } catch {
      /* not persisted */
    }
  }

  resetKeys(): void {
    this.keys = structuredClone(DEFAULT_KEYS);
    this.saveKeys();
  }

  private isBound(code: string): boolean {
    return this.keys.some((m) => ACTIONS.some((a) => m[a].includes(code)));
  }

  private readKb(layout: number): InputFrame {
    const m = this.keys[layout];
    if (!m) return 0;
    let bits = 0;
    for (const a of ACTIONS)
      if (m[a].some((k) => this.down.has(k) || this.tapped.has(k))) bits |= BIT[a];
    return bits;
  }

  private readPad(p: Gamepad): InputFrame {
    let bits = 0;
    for (const a of ACTIONS) if (this.pad[a].some((b) => p.buttons[b]?.pressed)) bits |= BIT[a];
    const ax = p.axes[0] ?? 0;
    const ay = p.axes[1] ?? 0;
    if (ax < -0.4) bits |= IN.LEFT;
    if (ax > 0.4) bits |= IN.RIGHT;
    if (ay < -0.4) bits |= IN.UP;
    if (ay > 0.4) bits |= IN.DOWN;
    return bits;
  }

  private pads(): Gamepad[] {
    return (navigator.getGamepads?.() ?? []).filter((p): p is Gamepad => !!p);
  }

  /** Assigns any unassigned device that is pressing something to the first free slot. */
  private assign(): void {
    const taken = (d: Device) =>
      this.slots.some(
        (s) =>
          s &&
          s.kind === d.kind &&
          (d.kind === "kb"
            ? (s as { layout: number }).layout === d.layout
            : (s as { index: number }).index === d.index),
      );
    const candidates: [Device, InputFrame][] = [];
    for (let l = 0; l < this.keys.length; l++)
      candidates.push([{ kind: "kb", layout: l }, this.readKb(l)]);
    for (const p of this.pads())
      candidates.push([{ kind: "pad", index: p.index }, this.readPad(p)]);
    for (const [d, bits] of candidates) {
      if (!bits || taken(d)) continue;
      const free = this.slots.findIndex((s, i) => !s && i < this.maxSlots);
      if (free < 0) return;
      this.slots[free] = d;
    }
  }

  /** Samples every slot. Call once per sim tick. */
  sample(): InputFrame[] {
    this.prev = this.cur;
    if (this.enabled) this.assign();
    const pads = this.pads();
    this.cur = this.slots.map((d, i) => {
      const inj = this.injected[i];
      if (inj !== null && inj !== undefined) return inj;
      if (!d || !this.enabled) return 0;
      if (d.kind === "kb") return this.readKb(d.layout);
      const p = pads.find((x) => x.index === d.index);
      return p ? this.readPad(p) : 0;
    });
    this.tapped.clear();
    return this.cur.slice();
  }

  /** Bits newly pressed this sample for a slot (menus). */
  pressed(slot: number): number {
    return (this.cur[slot] ?? 0) & ~(this.prev[slot] ?? 0);
  }

  /** Any slot pressed the bits this sample; returns the slot or -1. */
  anyPressed(bits: number): number {
    for (let i = 0; i < 4; i++) if (this.pressed(i) & bits) return i;
    return -1;
  }

  held(slot: number): number {
    return this.cur[slot] ?? 0;
  }

  deviceLabel(slot: number): string {
    const d = this.slots[slot];
    if (!d) return "—";
    return d.kind === "kb" ? `KEYBOARD ${d.layout + 1}` : `PAD ${d.index + 1}`;
  }

  release(slot: number): void {
    this.slots[slot] = null;
  }
}
