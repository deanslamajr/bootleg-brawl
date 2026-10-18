// The shipped SPA's shell: Pixi app at 480x270 integer-scaled, the fixed 60 Hz loop, scene
// switching, audio routing, the ?debug overlay and the window.__bootleg test hook.

import { Application, Container, TextureSource } from "pixi.js";
import {
  Bot,
  type CompiledContent,
  type InputFrame,
  type ModuleRegistry,
  VIEW_H,
  VIEW_W,
  TICK_HZ,
} from "@bb/engine";
import { AssetStore, Label } from "@bb/engine/render";
import { AudioEngine } from "@bb/engine/audio";
import { InputManager } from "@bb/engine/input";
import { loadSettings, saveSettings, type RunState, type Settings } from "./settings";

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
}

export class GameApp {
  readonly app = new Application();
  readonly assets = new AssetStore("./");
  readonly audio = new AudioEngine();
  input!: InputManager;
  content!: CompiledContent;
  registry!: ModuleRegistry;
  settings: Settings = loadSettings();
  run: RunState | null = null;
  /** Set by the GAME SELECT: ALL debug menu: the next new run starts at this stage. */
  pendingStage: string | null = null;
  scene: Scene | null = null;
  private acc = 0;
  private last = 0;
  readonly debug = new URLSearchParams(location.search).has("debug");
  private debugLabel: Label | null = null;
  private tickMs = 0;
  private fps = 0;
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
    window.addEventListener("resize", () => this.fit());
    this.fit();
    const unlock = () => this.audio.unlock();
    window.addEventListener("keydown", unlock, { once: false });
    window.addEventListener("pointerdown", unlock, { once: false });
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
    this.app.start();
  }

  /** Integer scaling with letterboxing; 4:3 bezel in cabinet mode. */
  fit(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const cab = this.settings.cabinetMode;
    // Cabinet mode letterboxes the 16:9 frame inside a 4:3 screen, like the original monitors.
    const boxH = cab ? (VIEW_W * 3) / 4 : VIEW_H;
    const scale = Math.max(1, Math.floor(Math.min(w / VIEW_W, h / boxH)));
    this.app.canvas.style.width = `${VIEW_W * scale}px`;
    this.app.canvas.style.height = `${VIEW_H * scale}px`;
    const bar = cab ? ((boxH - VIEW_H) / 2) * scale : 0;
    const screen = this.app.canvas.parentElement;
    if (screen) {
      screen.style.paddingTop = `${bar}px`;
      screen.style.paddingBottom = `${bar}px`;
      screen.style.background = cab ? "#000" : "";
    }
    document.body.classList.toggle("cabinet-mode", cab);
  }

  saveSettings(): void {
    saveSettings(this.settings);
    this.audio.setVolumes(this.settings.musicVolume, this.settings.sfxVolume);
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
      if (this.bots && "sim" in scene) {
        const sim = (scene as unknown as { sim: import("@bb/engine").Sim | null }).sim;
        if (sim) for (let i = 0; i < 4; i++) if (this.bots[i]) inputs[i] = this.bots[i]!.input(sim);
      }
      scene.tick(inputs);
      this.tickMs = this.tickMs * 0.9 + (performance.now() - t0) * 0.1;
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
