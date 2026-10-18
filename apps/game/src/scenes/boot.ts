// Loads the manifest and every bundle's data, validates it in dev builds, compiles the runtime
// tables and preloads the core assets.

import { Container } from "pixi.js";
import { buildShippedSchemas } from "@bb/schema";
import { compileContent, VIEW_W } from "@bb/engine";
import { createRegistry } from "@bb/mechanics";
import type { GameApp, Scene } from "../app";
import { C, label } from "../ui";

export class BootScene implements Scene {
  readonly name = "boot";
  readonly root = new Container();
  private readonly msg = label("NOW LOADING GAME 0 OF 999...", VIEW_W / 2, 120, {
    color: C.yellow,
    align: "center",
  });
  private readonly sub = label("", VIEW_W / 2, 136, { color: C.white, align: "center" });
  private done = false;

  constructor(private readonly app: GameApp) {
    this.root.addChild(this.msg, this.sub);
  }

  async enter(): Promise<void> {
    void this.load().catch((e: unknown) => {
      this.msg.set("CARTRIDGE ERROR. BLOW ON IT.", C.red);
      this.sub.set(String((e as Error).message ?? e).slice(0, 56));
      console.error(e);
    });
  }

  private async load(): Promise<void> {
    const app = this.app;
    const manifest = await app.assets.loadManifest();
    const raw = await app.assets.loadAllData((d, t) => this.sub.set(`BUNDLE ${d} OF ${t}`));
    app.registry = createRegistry([...raw.flags, ...app.flags]);
    if (import.meta.env.DEV) {
      // Dev builds validate on load; production trusts the build step.
      const s = buildShippedSchemas(app.registry.schemaFragments());
      for (const c of Object.values(raw.characters)) s.character.parse(c.file);
      for (const st of Object.values(raw.stages)) s.stage.parse(st.file);
    }
    app.content = compileContent(raw);
    if (!manifest.contentHash.endsWith(app.content.hash))
      console.warn("manifest content hash does not match the compiled content");
    await app.assets.ensureSheets(["items"]);
    await app.assets.loadSfx(Object.keys(raw.sfx.sounds));
    for (const [id, bytes] of app.assets.sfxBytes) app.audio.addSfx(id, bytes);
    this.done = true;
    const { TitleScene } = await import("./title");
    await app.setScene(new TitleScene(app));
    app.markReady();
  }

  tick(): void {
    if (!this.done) this.msg.alpha = (performance.now() >> 8) % 2 ? 1 : 0.6;
  }
}
