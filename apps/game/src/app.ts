// The shipped SPA's shell: Pixi app at 480x270 integer-scaled (or scaled to leave thumb gutters
// when the touch pad shows), the fixed 60 Hz loop, scene switching, audio routing, the ?debug
// overlay and the window.__bootleg test hook.

import { Application, Container, TextureSource, UPDATE_PRIORITY } from "pixi.js";
import {
  Bot,
  type CompiledContent,
  type InputFrame,
  type ModuleRegistry,
  VIEW_H,
  VIEW_W,
  TICK_HZ,
} from "@bb/engine";
import { AssetStore, Label, LineBook, localLineStore } from "@bb/engine/render";
import { AudioEngine } from "@bb/engine/audio";
import { InputManager } from "@bb/engine/input";
import { loadSettings, saveSettings, type RunState, type Settings } from "./settings";
import { MIN_GUTTER, TouchOverlay, type TouchStatus } from "./touch";

export interface Scene {
  readonly name: string;
  readonly root: Container;
  enter?(): void | Promise<void>;
  /** One fixed 60 Hz step with this tick's input frames. */
  tick(inputs: InputFrame[]): void;
  render?(alpha: number): void;
  exit?(): void;
  /** Exposed to the test hook and the debug overlay. */
  status?(): Record<string, unknown>;
  /** What the Escape key does on this scene. The touch PAUSE button calls it too. */
  escape?(): void;
  /** Pauses play without a way to resume from here: a blur, a hidden tab or the rotate message. */
  interrupt?(): void;
}

export class GameApp {
  readonly app = new Application();
  readonly assets = new AssetStore("./");
  readonly audio = new AudioEngine();
  /** Picks every spoken line and remembers what this browser saw, across playthroughs (D80). */
  readonly lines = new LineBook(localLineStore());
  input!: InputManager;
  content!: CompiledContent;
  registry!: ModuleRegistry;
  settings: Settings = loadSettings();
  run: RunState | null = null;
  /** Set by the GAME SELECT: ALL debug menu: the next new run starts at this stage. */
  pendingStage: string | null = null;
  scene: Scene | null = null;
  /** The on-screen pad. Null until init. */
  touch: TouchOverlay | null = null;
  private acc = 0;
  private last = 0;
  readonly debug = new URLSearchParams(location.search).has("debug");
  private debugLabel: Label | null = null;
  private tickMs = 0;
  private fps = 0;
  /** Test hook perf sampling: main-thread frame work and sim tick times, in ms. */
  private sampling = false;
  private readonly frameWork = new Ring(1200);
  private readonly tickWork = new Ring(1200);
  private frameStart = 0;
  /** Test hook: bots drive the joined slots, and the loop can run several ticks per frame. */
  bots: Bot[] | null = null;
  speed = 1;
  private switching = false;
  readonly flags = (new URLSearchParams(location.search).get("flags") ?? "")
    .split(",")
    .filter(Boolean);

  async init(mount: HTMLElement): Promise<void> {
    TextureSource.defaultOptions.scaleMode = "nearest";
    await this.app.init({
      width: VIEW_W,
      height: VIEW_H,
      background: "#1a1420",
      antialias: false,
      resolution: 1,
      preference: "webgl",
      autoStart: false,
    });
    mount.appendChild(this.app.canvas);
    this.input = new InputManager(window);
    this.touch = new TouchOverlay(this, mount.parentElement ?? document.body, mount);
    window.addEventListener("resize", () => this.fit());
    this.touch.evaluate();
    this.fit();
    const unlock = () => this.audio.unlock();
    window.addEventListener("keydown", unlock, { once: false });
    window.addEventListener("pointerdown", unlock, { once: false });
    // A touch grants user activation on release, not on press.
    window.addEventListener("pointerup", unlock, { once: false });
    window.addEventListener("touchend", unlock, { once: false });
    window.addEventListener("gamepadconnected", unlock);
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
    if (this.debug) {
      this.debugLabel = new Label("", { color: 0x6ae0c8 });
      this.debugLabel.position.set(4, VIEW_H - 22);
    }
    this.installHook();
    // v1 error reporting is console-only, tagged with the tick and state hash for a replay repro.
    window.addEventListener("error", (e) =>
      console.error("[bootleg]", e.message, this.scene?.status?.() ?? {}),
    );
    window.addEventListener("unhandledrejection", (e) =>
      console.error("[bootleg]", String(e.reason), this.scene?.status?.() ?? {}),
    );
    this.app.ticker.add(() => this.frame());
    // Runs after Pixi draws the stage (UPDATE_PRIORITY.LOW), so a sample covers the whole frame.
    this.app.ticker.add(
      () => {
        if (this.sampling) this.frameWork.push(performance.now() - this.frameStart);
      },
      undefined,
      UPDATE_PRIORITY.UTILITY,
    );
    this.app.start();
  }

  /**
   * Integer scaling with letterboxing; 4:3 bezel in cabinet mode. When the touch pad shows, the
   * scale is not snapped: the canvas fills the height if the width allows it, and never leaves a
   * control strip under MIN_GUTTER px plus the safe-area inset on each side.
   */
  fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cab = this.settings.cabinetMode;
    const pad = this.touch?.shown ?? false;
    // Cabinet mode letterboxes the 16:9 frame inside a 4:3 screen, like the original monitors.
    const boxH = cab ? (VIEW_W * 3) / 4 : VIEW_H;
    let scale = Math.max(1, Math.floor(Math.min(w / VIEW_W, h / boxH)));
    let insetL = 0;
    let insetR = 0;
    if (pad && this.touch) {
      const ins = this.touch.insets();
      insetL = ins.left;
      insetR = ins.right;
      const avail = w - insetL - insetR;
      const scaleH = h / boxH;
      const leftover = (avail - VIEW_W * scaleH) / 2;
      const gutter = Math.max(MIN_GUTTER, leftover);
      scale = Math.max(0.1, Math.min(scaleH, (avail - 2 * gutter) / VIEW_W));
    }
    this.app.canvas.style.width = `${VIEW_W * scale}px`;
    this.app.canvas.style.height = `${VIEW_H * scale}px`;
    const bar = cab ? ((boxH - VIEW_H) / 2) * scale : 0;
    const screen = this.app.canvas.parentElement;
    if (screen) {
      screen.style.paddingTop = `${bar}px`;
      screen.style.paddingBottom = `${bar}px`;
      screen.style.background = cab ? "#000" : "";
      const cabinet = screen.parentElement;
      if (cabinet) {
        cabinet.style.paddingLeft = insetL ? `${insetL}px` : "";
        cabinet.style.paddingRight = insetR ? `${insetR}px` : "";
      }
    }
    document.body.classList.toggle("cabinet-mode", cab);
    this.touch?.layout(w, h);
  }

  saveSettings(): void {
    saveSettings(this.settings);
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
    this.touch?.evaluate();
    this.fit();
  }

  async setScene(next: Scene): Promise<void> {
    if (this.switching) return;
    this.switching = true;
    try {
      if (this.scene) {
        this.scene.exit?.();
        this.app.stage.removeChild(this.scene.root);
        this.scene.root.destroy({ children: true });
      }
      this.scene = null;
      await next.enter?.();
      this.scene = next;
      this.app.stage.addChild(next.root);
      if (this.debugLabel) this.app.stage.addChild(this.debugLabel);
      this.acc = 0;
    } finally {
      this.switching = false;
    }
  }

  private frame(): void {
    const now = performance.now();
    this.frameStart = now;
    const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 1 / TICK_HZ;
    this.last = now;
    this.fps = this.fps * 0.95 + (1 / Math.max(1e-3, dt)) * 0.05;
    const scene = this.scene;
    if (!scene) return;
    this.acc += dt * this.speed;
    const step = 1 / TICK_HZ;
    let n = 0;
    while (this.acc >= step && n < 8 * this.speed) {
      const t0 = performance.now();
      const inputs = this.input.sample();
      this.touch?.afterSample();
      if (this.bots && "sim" in scene) {
        const sim = (scene as unknown as { sim: import("@bb/engine").Sim | null }).sim;
        if (sim) for (let i = 0; i < 4; i++) if (this.bots[i]) inputs[i] = this.bots[i]!.input(sim);
      }
      scene.tick(inputs);
      const ms = performance.now() - t0;
      this.tickMs = this.tickMs * 0.9 + ms * 0.1;
      if (this.sampling) this.tickWork.push(ms);
      this.acc -= step;
      n++;
      if (this.scene !== scene) return;
    }
    scene.render?.(Math.min(1, this.acc / step));
    if (this.debugLabel) {
      const st = scene.status?.() ?? {};
      this.debugLabel.set(
        `FPS ${this.fps.toFixed(0)} TICK ${this.tickMs.toFixed(2)}MS ${scene.name.toUpperCase()} ${Object.entries(
          st,
        )
          .map(([k, v]) => `${k.toUpperCase()} ${String(v).toUpperCase()}`)
          .join(" ")} BUNDLES ${this.assets.hits}`,
      );
    }
  }

  private installHook(): void {
    const hook = {
      status: () => ({ scene: this.scene?.name ?? "none", ...(this.scene?.status?.() ?? {}) }),
      inject: (slot: number, bits: number | null) => {
        this.input.injected[slot] = bits;
      },
      useBots: (on: boolean) => {
        this.bots = on ? [0, 1, 2, 3].map((i) => new Bot(i)) : null;
      },
      setSpeed: (n: number) => {
        this.speed = Math.max(1, Math.min(32, n));
      },
      /** Starts (clearing old samples) or stops perf sampling. */
      samplePerf: (on: boolean) => {
        if (on) {
          this.frameWork.clear();
          this.tickWork.clear();
        }
        this.sampling = on;
      },
      perf: () => ({ frame: this.frameWork.values(), tick: this.tickWork.values() }),
      /** The audio context state, the pause flag and the current track id. */
      audio: () => this.audio.status(),
      /** What the Escape key does on the current scene (the touch PAUSE button's path). */
      escape: () => this.scene?.escape?.(),
      /** The touch pad's state and its control rectangles in CSS px. */
      touch: (): TouchStatus => {
        if (this.touch) return this.touch.status();
        const b = this.app.canvas.getBoundingClientRect();
        const canvas = { x: b.x, y: b.y, w: b.width, h: b.height };
        return { shown: false, rotate: false, bits: 0, canvas, controls: {} };
      },
      /**
       * Screen rectangle of the first display object with this Pixi label in the scene, measured
       * as if the object itself were visible (GO blinks). Null when it is missing or empty.
       */
      bounds: (name: string) => {
        const node = this.scene?.root.getChildByLabel(name, true);
        if (!node) return null;
        const was = node.visible;
        node.visible = true;
        const b = node.getBounds();
        node.visible = was;
        return b.isEmpty() ? null : { x: b.x, y: b.y, w: b.width, h: b.height };
      },
      ready: false,
    };
    (window as unknown as { __bootleg: typeof hook }).__bootleg = hook;
  }

  markReady(): void {
    (window as unknown as { __bootleg: { ready: boolean } }).__bootleg.ready = true;
  }

  sfx(id: string, pan = 0): void {
    this.audio.play(id, pan);
  }

  music(id: string | undefined, stingerAfter?: string): void {
    if (!id) return this.audio.stopMusic();
    const t = this.content.raw.tracks[id];
    if (stingerAfter) this.audio.stinger(t, this.content.raw.tracks[stingerAfter]);
    else this.audio.playMusic(t);
  }
}

/** A fixed-size buffer that keeps the most recent samples. */
class Ring {
  private readonly data: Float64Array;
  private n = 0;
  constructor(size: number) {
    this.data = new Float64Array(size);
  }
  push(v: number): void {
    this.data[this.n % this.data.length] = v;
    this.n++;
  }
  clear(): void {
    this.n = 0;
  }
  values(): number[] {
    return Array.from(this.data.subarray(0, Math.min(this.n, this.data.length)));
  }
}
