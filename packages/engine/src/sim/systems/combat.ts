// Combat phase: hitbox-vs-hurtbox resolution, projectiles, thrown bodies, props, grabs, throws,
// KOs and pickups.

import { FX, intToFx, toFx } from "../../math/fixed";
import type { CBox, CHit, CState } from "../../content/types";
import type { Sim } from "../sim";
import { DIFFICULTY, F, KIND, SK, SLOT, TEAM } from "../types";
import { CONTINUE_TICKS } from "./control";
import { bossOnHit } from "./bosses";
import { gagPropHit } from "./gags";

interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

const THROWN_HIT: CHit = {
  box: { x: -12, z: 0, w: 24, h: 20 },
  damage: 14,
  kx: toFx(2.4),
  kz: toFx(3),
  hitstop: 6,
  hitstun: 24,
  knockdown: true,
  launch: false,
  grab: false,
  rehit: 0,
  sfx: "slam",
  score: 40,
  tags: ["thrown"],
  ground: false,
};

function hitRect(sim: Sim, e: number, b: CBox, facing: number, scalePct = 100): Rect {
  const c = sim.c;
  const x = c.x[e]! >> 16;
  const z = c.z[e]! >> 16;
  const bx = Math.trunc((b.x * scalePct) / 100);
  const bw = Math.trunc((b.w * scalePct) / 100);
  const bz = Math.trunc((b.z * scalePct) / 100);
  const bh = Math.trunc((b.h * scalePct) / 100);
  const x0 = facing >= 0 ? x + bx : x - bx - bw;
  return { x0, x1: x0 + bw, z0: z + bz, z1: z + bz + bh };
}

function hurtRects(sim: Sim, t: number): Rect[] {
  const c = sim.c;
  if (c.kind[t] === KIND.prop) {
    const p = sim.def(t).prop;
    if (!p) return [];
    return [hitRect(sim, t, p.hurt, 1)];
  }
  const f = sim.frame(t);
  const scale = c.tiny[t] ? 45 : 100;
  return f.hurt.map((b) => hitRect(sim, t, b, c.facing[t]!, scale));
}

function overlap(a: Rect, b: Rect, ignoreZ = false): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && (ignoreZ || (a.z0 < b.z1 && a.z1 > b.z0));
}

/** Two grounded fighters only compare x and lane; height matters once either is airborne. */
function grounded(sim: Sim, a: number, t: number): boolean {
  return sim.c.z[a]! <= 0 && sim.c.z[t]! <= 0 && sim.c.kind[t] !== KIND.prop;
}

/** Whether attacker team/state rules allow `a` to hit `t` at all. */
function eligible(sim: Sim, a: number, t: number, hit: CHit, weaponOrShot: boolean): boolean {
  const c = sim.c;
  if (t === a || !sim.world.alive[t]) return false;
  const kt = c.kind[t]!;
  if (kt === KIND.prop) {
    if (c.flags[t]! & F.invulnerable) return false;
    const p = sim.def(t).prop;
    if (!p || (!p.breakable && c.gag[t] === 0)) return false;
    return c.team[a] === TEAM.players || !!(c.flags[a]! & F.thrownBody);
  }
  if (kt !== KIND.player && kt !== KIND.enemy && kt !== KIND.boss && kt !== KIND.civilian)
    return false;
  const fl = c.flags[t]!;
  if (fl & (F.hidden | F.invulnerable | F.unfightable | F.teamFly | F.emerging)) return false;
  if (c.invuln[t]! > 0) return false;
  const st = sim.st(t);
  if (st.kind === SK.ko || c.hp[t]! <= 0) return false;
  // Three air hits per juggle, then the target falls in peace.
  if (c.z[t]! > 0 && (c.juggle[t]! & 0x7f) >= 3 && st.kind === SK.fall) return false;
  if (st.invulnFrom >= 0 && c.stick[t]! >= st.invulnFrom && c.stick[t]! <= st.invulnTo)
    return false;
  if (st.kind === SK.down && !hit.ground) return false;
  if (st.kind !== SK.down && hit.ground && !hit.tags.includes("any")) {
    // Ground-only hits (stomps) still connect with standing targets at the feet.
    if (c.z[t]! > 0) return false;
  }
  const ta = c.team[a]!;
  const tt = c.team[t]!;
  if (tt === TEAM.neutral) return ta === TEAM.players || !!(c.flags[a]! & F.thrownBody);
  if (ta === tt) {
    if (ta !== TEAM.players) return false;
    if (sim.friendlyFire === "chaos") return true;
    if (sim.friendlyFire === "weapons") return weaponOrShot;
    return false;
  }
  return true;
}

export function combatSystem(sim: Sim): void {
  if (sim.actorsFrozen) return;
  const c = sim.c;
  const w = sim.world;
  const tol = sim.laneTol;
  for (let a = 0; a < w.high; a++) {
    if (!w.alive[a] || c.hitstop[a]! > 0) continue;
    const kind = c.kind[a]!;
    if (kind === KIND.projectile) {
      projectileHits(sim, a, tol);
      continue;
    }
    if (kind !== KIND.player && kind !== KIND.enemy && kind !== KIND.boss) continue;
    if (c.flags[a]! & F.thrownBody) {
      thrownHits(sim, a, tol);
      continue;
    }
    const st = sim.st(a);
    if (!st.hasHit) continue;
    const f = sim.frame(a);
    if (f.hit.length === 0) continue;
    // Grab hits land on the held victim only.
    if (c.grab[a] && st.tags.includes("grabHit")) {
      const v = c.grab[a]! - 1;
      if (v >= 0 && w.alive[v]) {
        const key = (a << 16) | c.serial[a]!;
        if (!sim.hitLogHas(v, key)) {
          sim.hitLogPush(v, key);
          applyHit(sim, a, v, f.hit[0]!, c.facing[a]!, false);
          c.grabCount[a] = Math.min(255, c.grabCount[a]! + 1);
        }
      }
      continue;
    }
    const weapon = c.weapon[a]! > 0 && st.name.startsWith("wpn-");
    for (const hit of f.hit) {
      const hr = hitRect(sim, a, hit.box, c.facing[a]!, c.tiny[a] ? 50 : 100);
      const key =
        hit.rehit > 0
          ? (a << 16) | ((c.serial[a]! * 31 + Math.trunc(c.stick[a]! / hit.rehit)) & 0xffff)
          : (a << 16) | c.serial[a]!;
      for (let t = 0; t < w.high; t++) {
        if (c.grab[a] && c.grab[a] === t + 1) continue;
        if (!eligible(sim, a, t, hit, weapon)) continue;
        if (Math.abs((c.y[t]! - c.y[a]!) >> 16) > tol) continue;
        if (sim.hitLogHas(t, key)) continue;
        let hitIt = false;
        const flat = grounded(sim, a, t);
        for (const r of hurtRects(sim, t)) if (overlap(hr, r, flat)) hitIt = true;
        if (!hitIt) continue;
        sim.hitLogPush(t, key);
        if (hit.grab && c.kind[t] !== KIND.prop) {
          if (!c.grab[t] && sim.def(t).S.grabbed >= 0) startGrab(sim, a, t);
          break;
        }
        applyHit(sim, a, t, hit, c.facing[a]!, weapon);
        if (c.hitstop[a]! > 0 && hit.rehit === 0) {
          // Keep scanning: one swing can hit a crowd, all sharing the same hitstop.
        }
      }
    }
  }
}

function projectileHits(sim: Sim, p: number, tol: number): void {
  const c = sim.c;
  const w = sim.world;
  const d = sim.def(p).projectile!;
  if (c.flags[p]! & F.hidden) return;
  const owner = c.owner[p]! - 1;
  const hit: CHit = {
    box: d.box,
    damage: d.damage,
    kx: d.kx,
    kz: d.kz,
    hitstop: d.hitstop,
    hitstun: d.hitstun,
    knockdown: d.knockdown,
    launch: false,
    grab: false,
    rehit: 0,
    sfx: d.sfx,
    score: 15,
    tags: d.tags,
    ground: false,
  };
  const hr = hitRect(sim, p, d.box, c.facing[p]!, c.scale[p]! || 100);
  const key = (p << 16) | c.serial[p]!;
  for (let t = 0; t < w.high; t++) {
    if (t === owner || t === p) continue;
    if (!eligible(sim, p, t, hit, true)) continue;
    if (Math.abs((c.y[t]! - c.y[p]!) >> 16) > tol) continue;
    if (sim.hitLogHas(t, key)) continue;
    let hitIt = false;
    for (const r of hurtRects(sim, t)) if (overlap(hr, r)) hitIt = true;
    if (!hitIt) continue;
    sim.hitLogPush(t, key);
    const td = sim.def(t);
    // Sarge's hair: anything sharp that hits it stays there and falls out later.
    if (td.player?.gags.includes("hairCatch") && d.dropsPickup >= 0 && !c.stuck[t]) {
      c.stuck[t] = d.dropsPickup + 1;
      c.stuckTimer[t] = 240;
      sim.text("STUCK IN THE HAIR", "pop", t, 60);
      sim.sfx("boing", t);
      sim.despawn(p);
      return;
    }
    const scaled = { ...hit, damage: Math.trunc((hit.damage * (c.scale[p]! || 100)) / 100) };
    applyHit(sim, owner >= 0 && w.alive[owner] ? owner : p, t, scaled, c.facing[p]!, true, p);
    if (d.pierce > 0) {
      c.pierce[p] = c.pierce[p]! - 1;
      if (c.pierce[p] === 0) {
        sim.despawn(p);
        return;
      }
    }
  }
}

function thrownHits(sim: Sim, v: number, tol: number): void {
  const c = sim.c;
  const w = sim.world;
  const owner = c.owner[v]! - 1;
  const facing = c.vx[v]! >= 0 ? 1 : -1;
  const hr = hitRect(sim, v, THROWN_HIT.box, facing, sim.def(v).scalePct);
  const key = (v << 16) | c.serial[v]!;
  for (let t = 0; t < w.high; t++) {
    if (t === owner || t === v) continue;
    if (!eligible(sim, v, t, THROWN_HIT, false)) continue;
    // Thrown bodies ignore teams: they flatten whoever is in the way, players included.
    if (Math.abs((c.y[t]! - c.y[v]!) >> 16) > tol + 4) continue;
    if (sim.hitLogHas(t, key)) continue;
    let hitIt = false;
    for (const r of hurtRects(sim, t)) if (overlap(hr, r)) hitIt = true;
    if (!hitIt) continue;
    sim.hitLogPush(t, key);
    applyHit(sim, v, t, THROWN_HIT, facing, false, -1, true);
  }
}

/** Applies one connecting hit. `src` is the projectile entity when the hit came from one. */
export function applyHit(
  sim: Sim,
  a: number,
  t: number,
  hit: CHit,
  facing: number,
  weaponOrShot: boolean,
  src = -1,
  thrown = false,
): void {
  const c = sim.c;
  for (const m of sim.modules) if (m.hooks?.onHit?.(sim, a, t, hit)) return;
  if (c.kind[t] === KIND.prop) {
    hitProp(sim, a, t, hit.damage);
    return;
  }
  const da = sim.def(a);
  const dt = sim.def(t);
  let dmg = hit.damage;
  if (c.kind[a] !== KIND.projectile && !thrown) {
    dmg = Math.trunc((dmg * da.damagePct) / 100);
    if (da.enemy)
      dmg = Math.trunc(
        (dmg * da.enemy.tiers[Math.min(c.tier[a]!, da.enemy.tiers.length - 1)]!.damagePct) / 100,
      );
    if (c.weapon[a]! > 0 && weaponOrShot && c.kind[a] === KIND.player)
      dmg = Math.max(dmg, sim.content.weapons[c.weapon[a]! - 1]!.damage);
    if (c.tiny[a]) dmg = Math.trunc(dmg / 2);
  }
  if (c.kind[t] === KIND.player)
    dmg = Math.trunc((dmg * DIFFICULTY[sim.difficulty].damageTakenPct) / 100);
  let knockdown = hit.knockdown || hit.launch || c.z[t]! > 0;
  let flinch = true;
  if (dt.boss) {
    const r = bossOnHit(sim, a, t, hit, thrown, dmg);
    dmg = r.damage;
    knockdown = r.knockdown;
    flinch = r.flinch;
  }
  const st = sim.st(t);
  if (st.armor !== 0 && !knockdown) flinch = false;
  // Stun-lock breaker: a player hit four times in quick succession goes down and gets up safe.
  if (c.kind[t] === KIND.player && !knockdown) {
    c.strain[t] = c.strain[t]! + 1;
    c.strainTimer[t] = 70;
    if (c.strain[t]! >= 4) knockdown = true;
  }
  if (knockdown && c.kind[t] === KIND.player) c.strain[t] = 0;
  if (hit.damage > 0 && dmg < 1) dmg = 1;
  c.hp[t] = c.hp[t]! - dmg;
  const firstConnect = c.connected[a] === 0;
  c.connected[a] = 1;
  c.lastHitTick[a] = sim.g.tick;
  if (src < 0) c.hitstop[a] = hit.hitstop;
  c.hitstop[t] = hit.hitstop;

  // Being hit while holding someone lets go; a knockdown frees a held victim.
  if (c.grab[t]) {
    const partner = c.grab[t]! - 1;
    const pk = sim.world.alive[partner] ? sim.stateKind(partner) : -1;
    if (sim.isHolding(t)) breakGrab(sim, t, partner);
    else if (st.kind === SK.grabbed && (knockdown || c.hp[t]! <= 0) && pk >= 0)
      breakGrab(sim, partner, t);
  }
  if (sim.stateKind(t) !== SK.grabbed || knockdown) c.facing[t] = -facing || 1;

  const weightPct = Math.max(40, dt.weightPct);
  // The game screen shows a boss's hurt line at a chance, at most once per gap (D80).
  if (dt.boss && dmg > 0 && c.hp[t]! > 0) sim.say(dt.boss.pools.hurt, "bubble", t, 90);
  if (c.hp[t]! <= 0) {
    c.hp[t] = 0;
    knockOut(sim, a, t, facing, hit);
  } else if (knockdown && (flinch || hit.launch)) {
    sim.enterState(t, dt.S.fall >= 0 ? dt.S.fall : dt.S.hurt);
    c.vx[t] = Math.trunc((facing * hit.kx * 100) / weightPct);
    c.vz[t] = Math.max(hit.kz, toFx(2.4));
    c.z[t] = Math.max(c.z[t]!, 1);
    c.juggle[t] = Math.min(0x7f, (c.juggle[t]! & 0x7f) + 1);
    if (c.weapon[t]! > 0) dropWeapon(sim, t);
  } else if (flinch && st.kind !== SK.grabbed) {
    sim.enterState(t, dt.S.hurt >= 0 ? dt.S.hurt : dt.S.idle);
    c.stun[t] = hit.hitstun;
    c.vx[t] = Math.trunc((facing * hit.kx * 100) / weightPct);
  }

  // Weapon wear and the improvised weapon's hit count.
  if (c.kind[a] === KIND.player && src < 0 && !thrown) {
    const sa = sim.st(a);
    if (c.weapon[a]! > 0 && sa.name.startsWith("wpn-")) {
      c.weaponHits[a] = Math.max(0, c.weaponHits[a]! - 1);
      if (c.weaponHits[a] === 0) {
        sim.text(sim.content.weapons[c.weapon[a]! - 1]!.breakText, "pop", a, 60);
        sim.sfx("break", a);
        c.weapon[a] = 0;
      }
    } else if (
      sa.tags.includes("improvised") &&
      da.player?.improvised &&
      da.player.improvised.hits > 0 &&
      c.impro[a]
    ) {
      c.improHits[a] = Math.max(0, c.improHits[a]! - 1);
      if (c.improHits[a] === 0) {
        c.impro[a] = 0;
        c.improTimer[a] = da.player.improvised.respawn;
        sim.text(da.player.improvised.breakText ?? "IT BROKE.", "pop", a, 70);
        sim.sfx("break", a);
      }
    }
    // The genre's mercy rule: an on-hit special costs health once, on its first connect.
    if (sa.costOnHit && sa.costHp > 0 && firstConnect) sim.payCost(a, sa.costHp);
  }

  // Score, combos and statistics.
  const scorer = thrown ? c.owner[a]! - 1 : a;
  if (scorer >= 0 && sim.world.alive[scorer]) {
    sim.addScore(scorer, hit.score);
    const slot = sim.playerSlotOf(scorer);
    if (slot >= 0) {
      const p = sim.g.players[slot]!;
      p.dealt += dmg;
      c.combo[scorer] = c.comboTimer[scorer]! > 0 ? c.combo[scorer]! + 1 : 1;
      c.comboTimer[scorer] = 60;
      if (c.combo[scorer]! >= 3) sim.emit({ t: "combo", slot, count: c.combo[scorer]! });
      if (c.combo[scorer]! > p.bestCombo) p.bestCombo = c.combo[scorer]!;
    }
  }
  const tslot = sim.playerSlotOf(t);
  if (tslot >= 0) sim.g.players[tslot]!.taken += dmg;

  sim.sfx(hit.sfx, t);
  sim.emit({
    t: "hit",
    x: c.x[t]! / FX,
    y: c.y[t]! / FX,
    z: c.z[t]! / FX + 24,
    power: dmg,
    attacker: a,
    target: t,
    damage: dmg,
    tags: hit.tags,
  });
}

function knockOut(sim: Sim, a: number, t: number, facing: number, hit: CHit): void {
  const c = sim.c;
  const dt = sim.def(t);
  sim.enterState(t, dt.S.fall >= 0 ? dt.S.fall : dt.S.ko);
  c.vx[t] = facing * Math.max(Math.abs(hit.kx), toFx(2.6));
  c.vz[t] = toFx(3.4);
  c.z[t] = Math.max(1, c.z[t]!);
  c.juggle[t] = 0;
  if (c.grab[t]) c.grab[t] = 0;
  if (c.weapon[t]! > 0) dropWeapon(sim, t);
  if (c.aiToken[t]) {
    c.aiToken[t] = 0;
    sim.g.attackers = Math.max(0, sim.g.attackers - 1);
  }
  sim.emit({ t: "ko", ent: t, def: c.def[t]!, player: c.kind[t] === KIND.player });
  sim.emit({ t: "shake", ticks: 6 });
  sim.sfx("ko", t);
  const scorer =
    c.flags[a]! & F.thrownBody
      ? c.owner[a]! - 1
      : c.kind[a] === KIND.projectile
        ? c.owner[a]! - 1
        : a;
  if (dt.enemy && scorer >= 0) {
    const tier = dt.enemy.tiers[Math.min(c.tier[t]!, dt.enemy.tiers.length - 1)]!;
    if (!dt.enemy.civilian) sim.addScore(scorer, tier.score);
    const slot = sim.playerSlotOf(scorer);
    if (slot >= 0) sim.g.players[slot]!.kos++;
    sim.say(dt.enemy.pools.ko, "bubble", t, 90);
  }
  if (dt.boss && scorer >= 0) sim.addScore(scorer, 5000);
}

/** Called when a KO state's animation ends. */
export function koFinished(sim: Sim, e: number): void {
  const c = sim.c;
  const kind = c.kind[e]!;
  if (kind === KIND.player) {
    const slot = sim.playerSlotOf(e);
    const p = sim.g.players[slot]!;
    p.deaths++;
    p.lives--;
    if (c.weapon[e]! > 0) dropWeapon(sim, e);
    sim.despawn(e);
    if (p.lives > 0) {
      sim.spawnPlayer(slot);
    } else {
      p.status = SLOT.continue;
      p.contTimer = CONTINUE_TICKS;
      p.ent = -1;
      sim.emit({ t: "continue", slot, seconds: 10 });
    }
    return;
  }
  if (kind === KIND.boss) {
    if (c.flags[e]! & F.towing) return;
    const b = sim.def(e).boss!;
    sim.emit({ t: "bossDefeated", def: c.def[e]! });
    sim.say(b.pools.defeatBanner, "banner", -1, 140);
    sim.say(b.pools.defeat, "bubble", e, 150);
    if (b.defeat.kind === "towed") {
      // The battery dies and a tow truck hauls him away (see director towAway).
      c.flags[e]! |= F.towing | F.invulnerable;
      return;
    }
    sim.despawn(e);
    return;
  }
  const d = sim.def(e);
  if (d.enemy) {
    const tier = d.enemy.tiers[Math.min(c.tier[e]!, d.enemy.tiers.length - 1)]!;
    // Promoted mini-bosses always drop food; everyone else sometimes drops points.
    const food = sim.content.defIndex["pickup:roast-chicken"];
    const coin = sim.content.defIndex["pickup:quarter"];
    if (tier.miniBoss && food !== undefined)
      sim.spawnPickup(food, c.x[e]!, c.y[e]!, toFx(10), 0, toFx(2));
    else if (coin !== undefined && sim.rng.chance(12))
      sim.spawnPickup(coin, c.x[e]!, c.y[e]!, toFx(8), 0, toFx(2));
  }
  sim.despawn(e);
}

export function dropWeapon(sim: Sim, e: number): void {
  const c = sim.c;
  const w = c.weapon[e]!;
  if (w === 0) return;
  const ws = sim.content.weapons[w - 1]!;
  c.weapon[e] = 0;
  const p = sim.spawnPickup(
    ws.pickup,
    c.x[e]!,
    c.y[e]!,
    Math.max(c.z[e]!, toFx(12)),
    toFx(c.facing[e]! * -0.8),
    toFx(2.5),
  );
  if (p >= 0 && c.kind[e] !== KIND.player) sim.text("DISARMED", "pop", e, 45);
}

function hitProp(sim: Sim, a: number, prop: number, damage: number): void {
  const c = sim.c;
  const d = sim.def(prop);
  const p = d.prop!;
  c.hitstop[a] = Math.max(c.hitstop[a]!, 3);
  sim.sfx("thud", prop);
  gagPropHit(sim, prop, a);
  if (!p.breakable) return;
  c.hp[prop] = c.hp[prop]! - Math.max(1, damage);
  sim.emit({
    t: "hit",
    x: c.x[prop]! / FX,
    y: c.y[prop]! / FX,
    z: 12,
    power: damage,
    attacker: a,
    target: prop,
    damage,
    tags: [],
  });
  if (c.hp[prop]! > 0) return;
  c.variant[prop] = 1;
  c.flags[prop]! |= F.invulnerable;
  sim.sfx(p.breakSfx, prop);
  sim.addScore(a, p.score);
  // A placement's own drop table was rolled at placement time; otherwise roll the prop's.
  let item = -1;
  if (c.counter[prop]) item = (sim.g.flags[`drop:${prop}`] ?? 0) - 1;
  else if (p.drops.length) item = p.drops[sim.rng.weighted(p.drops.map((x) => x.weight))]!.item;
  if (item >= 0)
    sim.spawnPickup(
      item,
      c.x[prop]!,
      c.y[prop]! + 1,
      toFx(14),
      toFx(c.facing[a]! * 0.6),
      toFx(2.4),
    );
}

export function startGrab(sim: Sim, a: number, t: number): void {
  const c = sim.c;
  const da = sim.def(a);
  const dt = sim.def(t);
  if (da.S.grab < 0 || dt.S.grabbed < 0) return;
  sim.enterState(a, da.S.grab);
  sim.enterState(t, dt.S.grabbed);
  c.grab[a] = t + 1;
  c.grab[t] = a + 1;
  c.grabCount[a] = 0;
  c.grabTimer[a] = 110 + Math.trunc(da.weightPct / 4);
  c.vx[a] = 0;
  c.vx[t] = 0;
  c.vz[t] = 0;
  c.stun[t] = 0;
  c.facing[t] = -c.facing[a]!;
  sim.sfx("grab", a);
}

export function breakGrab(sim: Sim, a: number, v: number): void {
  const c = sim.c;
  if (c.grab[a] === v + 1) c.grab[a] = 0;
  if (c.grab[v] === a + 1) c.grab[v] = 0;
  if (sim.world.alive[a] && sim.isActor(a) && sim.isHolding(a))
    sim.enterState(a, sim.def(a).S.idle);
  if (sim.world.alive[v] && sim.isActor(v) && sim.stateKind(v) === SK.grabbed) {
    const dv = sim.def(v);
    sim.enterState(v, dv.S.hurt >= 0 ? dv.S.hurt : dv.S.idle);
    c.stun[v] = 8;
    c.vx[v] = (c.x[v]! >= c.x[a]! ? 1 : -1) * toFx(1.6);
  }
}

export function releaseThrow(sim: Sim, a: number, s: CState): void {
  const c = sim.c;
  const v = c.grab[a]! - 1;
  if (v < 0 || !sim.world.alive[v]) {
    c.grab[a] = 0;
    return;
  }
  c.grab[a] = 0;
  c.grab[v] = 0;
  const back = s.name === "throwB" || s.tags.includes("throwB");
  if (back) c.facing[a] = -c.facing[a]!;
  const dir = c.facing[a]!;
  const dv = sim.def(v);
  const da = sim.def(a);
  if (s.kind === SK.teamup || s.tags.includes("teamToss")) {
    sim.enterState(v, dv.S.teamFly >= 0 ? dv.S.teamFly : dv.S.jump);
    c.flags[v]! |= F.teamFly;
    c.owner[v] = a + 1;
    c.facing[v] = dir;
    c.vx[v] = dir * toFx(5.2);
    c.vz[v] = toFx(3.4);
    c.z[v] = Math.max(c.z[v]!, intToFx(20));
    sim.sfx("throw", a);
    return;
  }
  sim.enterState(v, dv.S.thrown >= 0 ? dv.S.thrown : dv.S.fall);
  c.flags[v]! |= F.thrownBody;
  c.owner[v] = a + 1;
  c.facing[v] = -dir;
  const weight = Math.max(50, dv.weightPct);
  c.vx[v] = Math.trunc((dir * toFx(4.4) * 100) / weight);
  c.vz[v] = toFx(3.2);
  c.z[v] = Math.max(c.z[v]!, intToFx(8));
  c.juggle[v] = 0;
  c.counter[v] = Math.trunc((18 * da.damagePct) / 100);
  sim.sfx("throw", a);
}

export function landThrown(sim: Sim, v: number): void {
  const c = sim.c;
  c.flags[v]! &= ~F.thrownBody;
  const owner = c.owner[v]! - 1;
  const dmg = Math.max(1, c.counter[v]!);
  c.counter[v] = 0;
  const dv = sim.def(v);
  let damage = dmg;
  if (c.kind[v] === KIND.player)
    damage = Math.trunc((damage * DIFFICULTY[sim.difficulty].damageTakenPct) / 100);
  c.hp[v] = Math.max(0, c.hp[v]! - damage);
  const vslot = sim.playerSlotOf(v);
  if (vslot >= 0) sim.g.players[vslot]!.taken += damage;
  sim.emit({
    t: "hit",
    x: c.x[v]! / FX,
    y: c.y[v]! / FX,
    z: 6,
    power: damage,
    attacker: owner >= 0 ? owner : v,
    target: v,
    damage,
    tags: ["slam"],
  });
  sim.emit({ t: "shake", ticks: 5 });
  sim.sfx("slam", v);
  if (owner >= 0 && sim.world.alive[owner]) sim.addScore(owner, 60);
  if (c.hp[v] === 0) {
    sim.emit({ t: "ko", ent: v, def: c.def[v]!, player: c.kind[v] === KIND.player });
    if (dv.enemy && owner >= 0) {
      const tier = dv.enemy.tiers[Math.min(c.tier[v]!, dv.enemy.tiers.length - 1)]!;
      sim.addScore(owner, tier.score);
      const slot = sim.playerSlotOf(owner);
      if (slot >= 0) sim.g.players[slot]!.kos++;
    }
  }
  c.owner[v] = 0;
  c.juggle[v] = 0x80;
  c.vz[v] = toFx(1.4);
  c.z[v] = 1;
  c.vx[v] = Math.trunc(c.vx[v]! / 3);
  sim.enterState(v, dv.S.fall >= 0 ? dv.S.fall : dv.S.down);
}

export function applyPickup(sim: Sim, e: number, item: number): void {
  const c = sim.c;
  const d = sim.def(item);
  const p = d.pickup!;
  switch (p.kind) {
    case "food":
    case "potion":
      c.hp[e] = Math.min(c.maxHp[e]!, c.hp[e]! + p.heal);
      sim.sfx("eat", e);
      break;
    case "weapon":
      if (p.weapon >= 0) {
        if (c.weapon[e]! > 0) dropWeapon(sim, e);
        c.weapon[e] = p.weapon + 1;
        c.weaponHits[e] = sim.content.weapons[p.weapon]!.hits;
        sim.sfx("pickup", e);
      }
      break;
    case "coin":
      sim.sfx("coin", e);
      break;
    case "credit":
      if (sim.g.credits >= 0) sim.g.credits++;
      sim.sfx("coin", e);
      break;
    case "mascot": {
      const run = sim.content.defIndex["proj:mascot-dash"];
      if (run !== undefined)
        sim.spawnProjectile(run, e, c.x[e]!, c.y[e]!, 0, c.facing[e]! * toFx(7), 0, c.facing[e]!);
      sim.sfx("whoosh", e);
      break;
    }
    case "ammo":
      break;
  }
  if (p.score) sim.addScore(e, p.score);
  if (p.text) sim.text(p.text, "pop", e, 60);
  sim.despawn(item);
}
