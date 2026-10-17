// The sandbox: a single-character training room and a stage preview harness in one app.
// It reuses the game's renderer and sim; everything here is tooling around them.

import { Application, Graphics, TextureSource } from "pixi.js";
import {
  Bot,
  compileContent,
  F,
  FX,
  KIND,
  Sim,
  VIEW_H,
  VIEW_W,
  type CBox,
  type CompiledContent,
  type InputFrame,
  type SandboxScene,
} from "@bb/engine";
import { AssetStore, StageRenderer } from "@bb/engine/render";
import { AudioEngine } from "@bb/engine/audio";
import { InputManager } from "@bb/engine/input";
import { ALL_MODULES, createRegistry } from "@bb/mechanics";

type Mode = "room" | "stage";

interface SceneConfig {
  mode: Mode;
  stage: string;
  segment: number;
  party: string[];
  director: boolean;
  bots: boolean;
  dummies: { family: string; tier: number; x: number; y: number; active: boolean }[];
}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const app = new Application();
const assets = new AssetStore("./");
const audio = new AudioEngine();
let content: CompiledContent;
let registry = createRegistry(new URLSearchParams(location.search).get("flags")?.split(",") ?? []);
let input: InputManager;
let sim: Sim | null = null;
let renderer: StageRenderer | null = null;
const overlay = new Graphics();
let paused = false;
let stepOnce = false;
let speed = 1;
let acc = 0;
let last = 0;
let recording: InputFrame[][] | null = null;
let playback: InputFrame[][] | null = null;
let playIdx = 0;
let bots: Bot[] = [];
const deaths: { stage: string; seg: number; x: number; y: number }[] = [];
const dealtWindow: number[] = [];
let bestCombo = 0;
let cfg: SceneConfig = {
  mode: "room",
  stage: "training-room",
  segment: 0,
  party: ["sarge"],
  director: false,
  bots: false,
  dummies: [],
};
let dragX: number | null = null;
/** True while content reloads: textures are being replaced, so nothing renders. */
let loading = false;

function log(line: string): void {
  const el = $<HTMLPreElement>("#log");
  el.textContent = `${line}\n${el.textContent ?? ""}`.slice(0, 8000);
}

async function loadContent(): Promise<void> {
  assets.reset();
  await assets.loadManifest();
  const raw = await assets.loadAllData();
  registry = createRegistry(new URLSearchParams(location.search).get("flags")?.split(",") ?? []);
  content = compileContent(raw);
  await assets.ensureSheets(["items"]);
  await assets.loadSfx(Object.keys(raw.sfx.sounds));
  for (const [id, b] of assets.sfxBytes) audio.addSfx(id, b);
}

let buildSeq = 0;

async function build(next: SceneConfig): Promise<void> {
  const token = ++buildSeq;
  cfg = next;
  const party = [0, 1, 2, 3].map((i) =>
    cfg.party[i] ? (content.defIndex[cfg.party[i]!] ?? -1) : -1,
  );
  const nextSim = new Sim({
    content,
    stageId: cfg.stage,
    seed: 1,
    registry,
    party,
    startSegment: cfg.segment,
    sandbox: !cfg.director,
  });
  // Skip the intro so the room is live immediately.
  for (let i = 0; i < 46; i++) nextSim.step([0, 0, 0, 0]);
  const sheets = StageRenderer.sheetsFor(content, nextSim);
  await Promise.all([assets.ensureSheets(sheets), assets.ensureLayers(cfg.stage)]);
  // A newer build started while this one was loading assets: let it win.
  if (token !== buildSeq) return;
  if (renderer) {
    app.stage.removeChild(renderer.root);
    renderer.destroy();
  }
  sim = nextSim;
  bots = [0, 1, 2, 3].map((i) => new Bot(i));
  for (const d of cfg.dummies) spawnDummy(d.family, d.tier, d.x, d.y, d.active);
  renderer = new StageRenderer(assets, content, sim, cfg.stage);
  app.stage.addChildAt(renderer.root, 0);
  app.stage.addChild(overlay);
  bestCombo = 0;
  dealtWindow.length = 0;
  renderPanel();
}

function spawnDummy(family: string, tier: number, x: number, y: number, active: boolean): void {
  if (!sim) return;
  const def = content.defIndex[family];
  if (def === undefined) return;
  const cam = sim.g.camX >> 16;
  const e = sim.spawnActor(def, tier, cam + x, y, 0, -1);
  if (e < 0) return;
  if (!active) sim.c.ai[e] = 8;
  sim.c.flags[e]! |= F.lockEnemy;
}

// ------------------------------------------------------------------ loop

function frame(): void {
  const now = performance.now();
  const dt = last ? Math.min(0.25, (now - last) / 1000) : 1 / 60;
  last = now;
  if (!sim || !renderer || loading) return;
  acc += dt * speed;
  let n = 0;
  while ((acc >= 1 / 60 && !paused) || stepOnce) {
    stepOnce = false;
    let inputs = input.sample();
    if (playback) {
      inputs = playback[playIdx++] ?? [0, 0, 0, 0];
      if (playIdx >= playback.length) {
        playback = null;
        log("playback finished");
      }
    }
    if (cfg.bots) for (let i = 0; i < 4; i++) if (cfg.party[i]) inputs[i] = bots[i]!.input(sim);
    if (recording) recording.push(inputs.slice());
    sim.step(inputs);
    renderer.onStep(sim.events);
    collect();
    acc -= 1 / 60;
    if (++n > 8) {
      acc = 0;
      break;
    }
  }
  renderer.update(paused ? 1 : Math.min(1, acc * 60));
  drawOverlay();
  updateStats();
}

function collect(): void {
  const s = sim!;
  const c = s.c;
  let dealt = 0;
  for (const ev of s.events) {
    if (ev.t === "sfx") audio.play(ev.id);
    if (ev.t === "hit") {
      const a = ev.attacker;
      const aname = s.world.alive[a] ? s.def(a).id : "?";
      const st = s.world.alive[a] && s.isActor(a) ? s.st(a) : null;
      const fi = st ? st.frameAt[Math.min(c.stick[a]!, st.total - 1)] : 0;
      const tname = s.world.alive[ev.target] ? s.def(ev.target).id : "?";
      log(
        `t=${s.g.tick} ${aname}${st ? ` ${st.name} f${fi}` : ""} -> ${tname}#${ev.target} dmg ${ev.damage} hitstop ${c.hitstop[ev.target]} stun ${c.stun[ev.target]}`,
      );
      if (s.world.alive[a] && c.kind[a] === KIND.player) dealt += ev.damage;
    }
    if (ev.t === "ko" && ev.player) {
      const e = ev.ent;
      deaths.push({ stage: cfg.stage, seg: s.g.seg, x: c.x[e]! / FX, y: c.y[e]! / FX });
    }
  }
  dealtWindow.push(dealt);
  if (dealtWindow.length > 300) dealtWindow.shift();
  const p = s.g.players[0]?.ent ?? -1;
  if (p >= 0 && s.world.alive[p])
    bestCombo = Math.max(bestCombo, c.comboTimer[p]! > 0 ? c.combo[p]! : 0);
}

function worldRect(e: number, b: CBox, facing: number): [number, number, number, number] {
  const c = sim!.c;
  const scale = c.tiny[e] ? 0.45 : 1;
  const bx = b.x * scale;
  const bw = b.w * scale;
  const x0 = facing >= 0 ? c.x[e]! / FX + bx : c.x[e]! / FX - bx - bw;
  return [x0, c.y[e]! / FX - c.z[e]! / FX - (b.z + b.h) * scale, bw, b.h * scale];
}

function drawOverlay(): void {
  overlay.clear();
  const s = sim!;
  const c = s.c;
  const cam = s.g.camX / FX;
  const show = (id: string) => $<HTMLInputElement>(id).checked;
  if (show("#ov-lane")) {
    overlay.rect(0, s.g.depthMin, VIEW_W, 1).fill({ color: 0x6ae0c8, alpha: 0.8 });
    overlay.rect(0, s.g.depthMax, VIEW_W, 1).fill({ color: 0x6ae0c8, alpha: 0.8 });
    const seg = s.segment();
    for (const l of seg.scrollLocks) {
      const x = l.at - cam;
      overlay.rect(x, 0, 1, VIEW_H).fill({ color: l.hold ? 0xf04a3a : 0xffb04a, alpha: 0.7 });
      overlay
        .rect(x + VIEW_W - 1, 0, 1, VIEW_H)
        .fill({ color: l.hold ? 0xf04a3a : 0xffb04a, alpha: 0.3 });
    }
    for (const gb of seg.groundBounds)
      overlay
        .circle(gb[0] - cam, gb[1], 2)
        .fill(0x6ae0c8)
        .circle(gb[0] - cam, gb[2], 2)
        .fill(0x6ae0c8);
    for (const d of deaths)
      if (d.stage === cfg.stage && d.seg === s.g.seg)
        overlay.circle(d.x - cam, d.y, 3).fill({ color: 0xf04a3a, alpha: 0.6 });
  }
  for (let e = 0; e < s.world.high; e++) {
    if (!s.world.alive[e] || !s.isActor(e)) continue;
    const f = s.frame(e);
    const fac = c.facing[e]!;
    if (show("#ov-hurt"))
      for (const b of f.hurt) {
        const [x, y, w, h] = worldRect(e, b, fac);
        overlay.rect(x - cam, y, w, h).stroke({ color: 0x5ac04a, width: 1, alpha: 0.9 });
      }
    if (show("#ov-hit"))
      for (const h of f.hit) {
        const [x, y, w, hh] = worldRect(e, h.box, fac);
        overlay
          .rect(x - cam, y, w, hh)
          .fill({ color: 0xf04a3a, alpha: 0.25 })
          .stroke({ color: 0xf04a3a, width: 1 });
      }
    if (show("#ov-push")) {
      const pw = s.def(e).pushW;
      overlay
        .rect(c.x[e]! / FX - pw - cam, c.y[e]! / FX - 2, pw * 2, 4)
        .stroke({ color: 0x4aa0f0, width: 1 });
    }
  }
}

function updateStats(): void {
  const s = sim!;
  const p = s.g.players[0]?.ent ?? -1;
  const dps = dealtWindow.reduce((a, b) => a + b, 0) / Math.max(1, dealtWindow.length / 60);
  let st = "";
  if (p >= 0 && s.world.alive[p]) {
    const state = s.st(p);
    st = `${state.name} f${state.frameAt[Math.min(s.c.stick[p]!, state.total - 1)]} t${s.c.stick[p]} hp ${s.c.hp[p]}/${s.c.maxHp[p]} combo ${s.c.comboTimer[p] ? s.c.combo[p] : 0}`;
  }
  $("#stats").textContent =
    `tick ${s.g.tick}  ${st}  DPS ${dps.toFixed(1)}  best combo ${bestCombo}  ents ${s.world.count()}  hash ${s.hash().toString(16)}${recording ? "  ● REC" : ""}${playback ? "  ▶ PLAY" : ""}`;
  $("#status").textContent =
    `${cfg.stage} seg ${s.g.seg} cam ${s.g.camX >> 16} phase ${s.g.phase}${paused ? " PAUSED" : ""}`;
}

// ------------------------------------------------------------------ panel

function opt(value: string, label = value, selected = false): string {
  return `<option value="${value}"${selected ? " selected" : ""}>${label}</option>`;
}

function renderPanel(): void {
  const panel = $("#panel");
  const chars = Object.keys(content.raw.characters).sort();
  const fams = Object.keys(content.raw.enemies).sort();
  const bosses = Object.keys(content.raw.bosses).sort();
  const stages = Object.keys(content.raw.stages).sort();
  const scenes = ALL_MODULES.map((m) => ({ id: m.id, scene: m.sandboxScene?.() })).filter(
    (s): s is { id: string; scene: SandboxScene } => !!s.scene,
  );
  const st = content.raw.stages[cfg.stage]!;
  const p = sim?.g.players[0]?.ent ?? -1;
  const pd = p >= 0 && sim?.world.alive[p] ? sim.def(p) : null;
  const alts = pd ? (content.raw.characters[pd.id]?.file.altPalettes ?? []) : [];
  panel.innerHTML = `
    <h3>${cfg.mode === "room" ? "Character room" : "Stage preview"}</h3>
    <div class="row">P1 <select id="char">${chars.map((c) => opt(c, c, c === cfg.party[0])).join("")}</select>
      P2 <select id="char2">${opt("", "—")}${chars.map((c) => opt(c, c, c === cfg.party[1])).join("")}</select>
      <label><input type="checkbox" id="bots" ${cfg.bots ? "checked" : ""}/> bots drive</label></div>
    <div class="row">Palette <select id="palette">${opt("0", pd?.palette ?? "base")}${alts.map((a, i) => opt(String(i + 1), a)).join("")}</select></div>
    ${
      cfg.mode === "stage"
        ? `<div class="row">Stage <select id="stage">${stages.map((s) => opt(s, s, s === cfg.stage)).join("")}</select>
           Segment <select id="segment">${st.file.segments.map((s, i) => opt(String(i), s, i === cfg.segment)).join("")}</select>
           <label><input type="checkbox" id="director" ${cfg.director ? "checked" : ""}/> director</label></div>
           <div class="row"><button id="load">Load</button><span class="dim">drag the view to move the camera</span></div>
           <h3>Waves on demand</h3>
           <div class="row">${(st.segments[st.file.segments[cfg.segment]!]?.scrollLocks ?? []).map((l) => `<button data-lock="${l.id}">${l.id}${l.hold ? "" : " (walk-on)"}</button>`).join("")}</div>
           <h3>Layers</h3><div class="row" id="layers"></div>
           <h3>Replays and heat map</h3>
           <div class="row"><input type="file" id="replays" multiple accept=".json"/><button id="clear-deaths">Clear deaths (${deaths.length})</button></div>`
        : `<h3>Dummies</h3>
           <div class="row"><select id="fam">${[...fams, ...bosses].map((f) => opt(f)).join("")}</select>
             tier <select id="tier">${[0, 1, 2, 3].map((t) => opt(String(t))).join("")}</select>
             <label><input type="checkbox" id="active"/> AI on</label><button id="spawn">Spawn</button><button id="clear">Clear</button></div>`
    }
    <h3>Module scenes</h3>
    <div class="row"><select id="scene">${scenes.map((s) => opt(s.id, `${s.id}: ${s.scene.title}`)).join("")}</select><button id="scene-go">Load scene</button></div>
    <h3>Box editor <span class="dim">(pause first; values in unit space)</span></h3>
    <div id="boxes" class="dim">pause to edit the current frame</div>
    <h3>Scripted input</h3>
    <div class="row"><button id="rec">${recording ? "Stop recording" : "Record"}</button><button id="play">Play back</button><button id="save-replay">Download</button></div>
    <textarea id="script" placeholder="recorded inputs (RLE JSON)"></textarea>
  `;
  const on = (sel: string, ev: string, fn: (e: Event) => void) =>
    panel.querySelector(sel)?.addEventListener(ev, fn);
  on(
    "#char",
    "change",
    () => void build({ ...cfg, party: [$<HTMLSelectElement>("#char").value, cfg.party[1] ?? ""] }),
  );
  on(
    "#char2",
    "change",
    () => void build({ ...cfg, party: [cfg.party[0]!, $<HTMLSelectElement>("#char2").value] }),
  );
  on("#bots", "change", () => (cfg.bots = $<HTMLInputElement>("#bots").checked));
  on("#palette", "change", () => {
    if (sim && p >= 0) sim.c.variant[p] = Number($<HTMLSelectElement>("#palette").value);
  });
  on("#spawn", "click", () => {
    const d = {
      family: $<HTMLSelectElement>("#fam").value,
      tier: Number($<HTMLSelectElement>("#tier").value),
      x: 330,
      y: 220,
      active: $<HTMLInputElement>("#active").checked,
    };
    cfg.dummies.push(d);
    spawnDummy(d.family, d.tier, d.x, d.y, d.active);
  });
  on("#clear", "click", () => void build({ ...cfg, dummies: [] }));
  on(
    "#stage",
    "change",
    () => void build({ ...cfg, stage: $<HTMLSelectElement>("#stage").value, segment: 0 }),
  );
  on(
    "#segment",
    "change",
    () => void build({ ...cfg, segment: Number($<HTMLSelectElement>("#segment").value) }),
  );
  on(
    "#director",
    "change",
    () => void build({ ...cfg, director: $<HTMLInputElement>("#director").checked }),
  );
  on("#load", "click", () => void build({ ...cfg }));
  panel.querySelectorAll<HTMLButtonElement>("[data-lock]").forEach((b) =>
    b.addEventListener("click", () => {
      const lock = sim!.segment().scrollLocks.find((l) => l.id === b.dataset.lock);
      for (const w of lock?.waves ?? []) sim!.queueWave(w, 0);
      log(`queued waves of ${b.dataset.lock}`);
    }),
  );
  on("#scene-go", "click", () => {
    const s = scenes.find((x) => x.id === $<HTMLSelectElement>("#scene").value)!.scene;
    void build({
      mode: s.stage ? "stage" : "room",
      stage: s.stage ?? "training-room",
      segment: s.segment ?? 0,
      party: s.characters,
      director: !!s.stage,
      bots: false,
      dummies: (s.dummies ?? []).map((d) => ({ ...d, active: false })),
    });
  });
  on("#rec", "click", () => {
    if (recording) {
      $<HTMLTextAreaElement>("#script").value = JSON.stringify(rle(recording));
      recording = null;
    } else recording = [];
    renderPanel();
  });
  on("#play", "click", () => {
    try {
      playback = unrle(JSON.parse($<HTMLTextAreaElement>("#script").value) as number[][]);
      playIdx = 0;
      void build({ ...cfg });
    } catch {
      log("script is not valid RLE JSON");
    }
  });
  on("#save-replay", "click", () => {
    const blob = new Blob([$<HTMLTextAreaElement>("#script").value], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${cfg.stage}-${cfg.party.join("-")}.inputs.json`;
    a.click();
  });
  on("#replays", "change", (e) => void heatmapFromFiles((e.target as HTMLInputElement).files));
  on("#clear-deaths", "click", () => {
    deaths.length = 0;
    renderPanel();
  });
  if (cfg.mode === "stage") renderLayerToggles();
  renderBoxes();
}

function renderLayerToggles(): void {
  const el = $("#layers");
  const r = renderer as unknown as {
    layers?: { ref: { layer: string }; node: { visible: boolean } }[];
  } | null;
  const layers = r?.layers ?? [];
  el.innerHTML = layers
    .map(
      (l, i) => `<label><input type="checkbox" data-layer="${i}" checked/> ${l.ref.layer}</label>`,
    )
    .join("");
  el.querySelectorAll<HTMLInputElement>("[data-layer]").forEach((cb) =>
    cb.addEventListener("change", () => {
      const l = layers[Number(cb.dataset.layer)];
      if (l) l.node.visible = cb.checked;
    }),
  );
}

function renderBoxes(): void {
  const el = $("#boxes");
  const s = sim;
  if (!s || !paused) {
    el.textContent = "pause to edit the current frame";
    return;
  }
  const p = s.g.players[0]?.ent ?? -1;
  if (p < 0 || !s.world.alive[p]) return;
  const d = s.def(p);
  const st = s.st(p);
  const fi = st.frameAt[Math.min(s.c.stick[p]!, st.total - 1)]!;
  const f = st.frames[fi]!;
  const unit = (v: number) => Math.round((v * 1000) / d.scalePct) / 10;
  const rows = [
    ...f.hit.map((h, i) => ({ type: "hit", i, b: h.box })),
    ...f.hurt.map((b, i) => ({ type: "hurt", i, b })),
  ];
  el.innerHTML = `<div>${d.id} · ${st.name} · frame ${fi} (${f.pose})</div><table>${rows
    .map(
      (r) =>
        `<tr><td>${r.type} ${r.i}</td>${(["x", "z", "w", "h"] as const)
          .map(
            (k) =>
              `<td><input type="number" step="0.5" data-k="${k}" data-row="${r.type}:${r.i}" value="${unit(r.b[k])}"/></td>`,
          )
          .join("")}<td><button data-write="${r.type}:${r.i}">Write</button></td></tr>`,
    )
    .join("")}</table>`;
  el.querySelectorAll<HTMLButtonElement>("[data-write]").forEach((b) =>
    b.addEventListener("click", async () => {
      const [type, idx] = b.dataset.write!.split(":");
      const vals = ["x", "z", "w", "h"].map((k) =>
        Number(
          el.querySelector<HTMLInputElement>(`input[data-row="${b.dataset.write}"][data-k="${k}"]`)!
            .value,
        ),
      );
      const kind = d.kind === "player" ? "characters" : d.kind === "boss" ? "bosses" : "enemies";
      const res = await fetch("/__sandbox/box", {
        method: "POST",
        body: JSON.stringify({
          kind,
          id: d.id,
          state: st.name,
          frame: fi,
          type,
          index: Number(idx),
          box: vals,
        }),
      });
      const j = (await res.json()) as { ok: boolean; file?: string; error?: string };
      log(j.ok ? `wrote ${j.file}; repacking...` : `box write failed: ${j.error}`);
    }),
  );
}

// ------------------------------------------------------------------ replays

function rle(frames: InputFrame[][]): number[][] {
  const out: number[][] = [];
  for (const f of frames) {
    const l = out[out.length - 1];
    if (l && l[1] === f[0] && l[2] === f[1] && l[3] === f[2] && l[4] === f[3]) l[0]!++;
    else out.push([1, f[0] ?? 0, f[1] ?? 0, f[2] ?? 0, f[3] ?? 0]);
  }
  return out;
}

function unrle(runs: number[][]): InputFrame[][] {
  const out: InputFrame[][] = [];
  for (const [n, a, b, c, d] of runs) for (let i = 0; i < n!; i++) out.push([a!, b!, c!, d!]);
  return out;
}

/** Replays golden or recorded stage sessions headless and plots where players died. */
async function heatmapFromFiles(files: FileList | null): Promise<void> {
  if (!files) return;
  for (const file of Array.from(files)) {
    const g = JSON.parse(await file.text()) as {
      stage?: string;
      party?: string[];
      seed?: number;
      inputs: number[][];
      kind?: string;
    };
    if (!g.stage || !g.party || g.kind === "character") {
      log(`${file.name}: not a stage replay`);
      continue;
    }
    const s = new Sim({
      content,
      stageId: g.stage,
      seed: g.seed ?? 1,
      registry,
      party: [0, 1, 2, 3].map((i) => (g.party![i] ? content.defIndex[g.party![i]!]! : -1)),
    });
    const frames = unrle(g.inputs);
    let n = 0;
    for (const f of frames) {
      s.step(f);
      for (const ev of s.events)
        if (ev.t === "ko" && ev.player) {
          deaths.push({
            stage: g.stage,
            seg: s.g.seg,
            x: s.c.x[ev.ent]! / FX,
            y: s.c.y[ev.ent]! / FX,
          });
          n++;
        }
    }
    log(`${file.name}: replayed ${frames.length} ticks, ${n} deaths`);
  }
  renderPanel();
}

// ------------------------------------------------------------------ boot

async function main(): Promise<void> {
  TextureSource.defaultOptions.scaleMode = "nearest";
  await app.init({
    width: VIEW_W,
    height: VIEW_H,
    background: "#1a1420",
    antialias: false,
    preference: "webgl",
  });
  $("#screen").appendChild(app.canvas);
  input = new InputManager(window);
  window.addEventListener("keydown", (e) => {
    audio.unlock();
    if (
      (e.target as HTMLElement).tagName === "INPUT" ||
      (e.target as HTMLElement).tagName === "TEXTAREA"
    )
      return;
    if (e.code === "KeyP") togglePause();
    if (e.code === "Period") stepOnce = true;
    if (e.code === "KeyR" && !e.metaKey && !e.ctrlKey) void reload();
  });
  $("#pause").addEventListener("click", togglePause);
  $("#step").addEventListener("click", () => (stepOnce = true));
  $("#speed").addEventListener(
    "change",
    () => (speed = Number($<HTMLSelectElement>("#speed").value)),
  );
  $("#reload").addEventListener("click", () => void reload());
  document.querySelectorAll<HTMLButtonElement>("[data-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      document.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
      const mode = b.dataset.mode as Mode;
      void build(
        mode === "room"
          ? { ...cfg, mode, stage: "training-room", segment: 0, director: false }
          : { ...cfg, mode, stage: content.raw.campaign.start, segment: 0, director: true },
      );
    }),
  );
  app.canvas.addEventListener("pointerdown", (e) => (dragX = e.clientX));
  window.addEventListener("pointerup", () => (dragX = null));
  window.addEventListener("pointermove", (e) => {
    if (dragX === null || !sim) return;
    const scale = app.canvas.getBoundingClientRect().width / VIEW_W;
    sim.g.flags.camControlled = 1;
    sim.g.camX = Math.max(
      0,
      Math.min((sim.g.segLen - VIEW_W) * FX, sim.g.camX - ((e.clientX - dragX) / scale) * FX),
    );
    sim.prevCamX = sim.g.camX;
    dragX = e.clientX;
  });
  await loadContent();
  await build(cfg);
  app.ticker.add(frame);
  if (import.meta.hot) import.meta.hot.on("bootleg:content", () => void reload());
}

function togglePause(): void {
  paused = !paused;
  renderBoxes();
}

async function reload(): Promise<void> {
  const keep = { ...cfg };
  loading = true;
  try {
    if (renderer) {
      app.stage.removeChild(renderer.root);
      renderer.destroy();
      renderer = null;
    }
    await loadContent();
    await build(keep);
  } finally {
    loading = false;
  }
  log("content reloaded");
}

void main();
