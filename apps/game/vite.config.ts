import { defineConfig, type Plugin } from "vite";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";

const ROOT = resolve(__dirname, "../..");

/** Re-packs content when files under content/ change and tells the page. */
export function contentPlugin(): Plugin {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  return {
    name: "bootleg-content",
    configureServer(server) {
      server.watcher.add(resolve(ROOT, "content"));
      const repack = () => {
        if (running) return;
        running = true;
        const p = spawn("pnpm", ["tools", "pack"], { cwd: ROOT, stdio: "inherit" });
        p.on("exit", (code) => {
          running = false;
          if (code === 0) server.ws.send({ type: "custom", event: "bootleg:content" });
        });
      };
      server.watcher.on("change", (file) => {
        if (!file.startsWith(resolve(ROOT, "content")) || file.endsWith("manifest.json")) return;
        clearTimeout(timer);
        timer = setTimeout(repack, 250);
      });
    },
  };
}

/** Writes .gz and .br next to every text asset in dist/ so nginx can serve them pre-compressed. */
function compressPlugin(): Plugin {
  const exts = /\.(js|css|html|json|svg|wav|txt|webmanifest)$/;
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  return {
    name: "bootleg-compress",
    apply: "build",
    closeBundle() {
      const out = resolve(ROOT, "dist");
      for (const file of walk(out)) {
        if (!exts.test(file)) continue;
        const buf = readFileSync(file);
        if (buf.length < 1024) continue;
        writeFileSync(`${file}.gz`, gzipSync(buf, { level: 9 }));
        writeFileSync(
          `${file}.br`,
          brotliCompressSync(buf, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }),
        );
      }
    },
  };
}

export default defineConfig({
  root: __dirname,
  publicDir: resolve(ROOT, "generated/public"),
  plugins: [contentPlugin(), compressPlugin()],
  server: { port: 5180, strictPort: false },
  preview: { port: 4180, strictPort: true },
  build: {
    outDir: resolve(ROOT, "dist"),
    emptyOutDir: true,
    target: "es2022",
    assetsDir: "assets",
    chunkSizeWarningLimit: 1500,
  },
});
