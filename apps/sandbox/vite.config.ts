import { defineConfig, type Plugin } from "vite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { contentPlugin } from "../game/vite.config";

const ROOT = resolve(__dirname, "../..");
const CONTENT = resolve(ROOT, "content");

type Json = Record<string, unknown>;
interface StatesFile {
  extends?: string;
  states: Record<string, Json>;
  patch?: Record<string, Json>;
  remove?: string[];
}

/** Resolves a states file's extends chain (the same rules as the engine's resolveStates). */
function resolveStates(file: StatesFile): Record<string, Json> {
  let base: Record<string, Json> = {};
  if (file.extends?.startsWith("template:")) {
    const tpl = resolve(CONTENT, "templates", `${file.extends.slice(9)}.states.json`);
    base = resolveStates(JSON.parse(readFileSync(tpl, "utf8")) as StatesFile);
  }
  const out = { ...base, ...file.states };
  for (const [k, p] of Object.entries(file.patch ?? {})) if (out[k]) out[k] = { ...out[k], ...p };
  for (const k of file.remove ?? []) delete out[k];
  return out;
}

/** POST /__sandbox/box: the box editor writes a hit or hurt box into an actor's states.json. */
function boxEditorPlugin(): Plugin {
  return {
    name: "bootleg-box-editor",
    configureServer(server) {
      server.middlewares.use("/__sandbox/box", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        let body = "";
        req.on("data", (c: Buffer) => (body += c.toString()));
        req.on("end", () => {
          try {
            const b = JSON.parse(body) as {
              kind: string;
              id: string;
              state: string;
              frame: number;
              type: "hit" | "hurt";
              index: number;
              box: number[];
            };
            if (!["characters", "enemies", "bosses"].includes(b.kind) || !/^[a-z0-9-]+$/.test(b.id))
              throw new Error("bad target");
            const path = resolve(CONTENT, b.kind, b.id, "states.json");
            if (!existsSync(path)) throw new Error(`${path} not found`);
            const file = JSON.parse(readFileSync(path, "utf8")) as StatesFile;
            file.states ??= {};
            if (!file.states[b.state]) {
              // Copy the inherited state into the file so the edit stays local to this actor.
              const resolved = resolveStates(file)[b.state];
              if (!resolved) throw new Error(`no state ${b.state}`);
              file.states[b.state] = structuredClone(resolved);
              if (file.patch?.[b.state]) delete file.patch[b.state];
            }
            const frames = (file.states[b.state] as { frames: Json[] }).frames;
            const fr = frames[b.frame];
            if (!fr) throw new Error(`no frame ${b.frame}`);
            const box = b.box.map((v) => Math.round(v * 10) / 10);
            if (b.type === "hit") {
              const hits = fr.hit as { box: number[] }[] | undefined;
              if (!hits?.[b.index]) throw new Error("no such hitbox");
              hits[b.index]!.box = box;
            } else {
              const hurt = Array.isArray(fr.hurt) ? (fr.hurt as number[][]) : [];
              hurt[b.index] = box;
              fr.hurt = hurt;
            }
            writeFileSync(path, JSON.stringify(file, null, 1) + "\n");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true, file: path.slice(ROOT.length + 1) }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: (e as Error).message }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  root: __dirname,
  publicDir: resolve(ROOT, "generated/public"),
  plugins: [contentPlugin(), boxEditorPlugin()],
  server: { port: 5181, strictPort: false },
  build: { outDir: resolve(ROOT, "dist-sandbox"), emptyOutDir: true, target: "es2022" },
});
