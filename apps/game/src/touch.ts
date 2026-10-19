// The on-screen pad for one touch player: a floating stick in the left gutter, a diamond of four
// buttons plus START in the right gutter, and PAUSE. It is DOM inside #cabinet and outside
// #screen, so it never covers the canvas. Pointer Events feed InputManager.setTouch with a mask
// that is rebuilt from every live pointer on each event, so a lost event cannot leave a bit
// stuck. PAUSE is not a bit: it calls the scene's escape() hook, as the Escape key does.
// The OFF setting takes effect only after a keyboard or a gamepad is used in the session, so a
// phone player who picks OFF with no keyboard keeps the pad until a reload.

import { IN, type InputFrame } from "@bb/engine";
import { stickBits } from "@bb/engine/input";
import type { GameApp } from "./app";

/** Full travel of the stick, in CSS px. */
export const STICK_RADIUS = 40;
/** The narrowest control strip GameApp.fit leaves on each side when the pad shows. */
export const MIN_GUTTER = 100;
/** A pointer this far past a button's edge still holds it. */
const SLACK = 6;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TouchStatus {
  shown: boolean;
  rotate: boolean;
  bits: number;
  canvas: Rect;
  controls: Record<string, Rect>;
}

type Hold =
  | { kind: "stick"; ox: number; oy: number; bits: number }
  | { kind: "button"; bit: number }
  | { kind: "pause" }
  | { kind: "none" };

interface Button {
  name: string;
  bit: number;
  el: HTMLElement;
  round: boolean;
}

function rect(el: Element): Rect {
  const b = el.getBoundingClientRect();
  return { x: b.x, y: b.y, w: b.width, h: b.height };
}

function el(tag: string, cls: string, text = ""): HTMLElement {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
}

export class TouchOverlay {
  shown = false;
  rotate = false;
  /** The mask last passed to setTouch. */
  bits: InputFrame = 0;
  private readonly left = el("div", "touch-gutter touch-left");
  private readonly right = el("div", "touch-gutter touch-right");
  private readonly zone = el("div", "touch-zone");
  private readonly ring = el("div", "touch-ring");
  private readonly knob = el("div", "touch-knob");
  private readonly pause = el("div", "touch-btn touch-wide", "PAUSE");
  private readonly message = el("div", "touch-rotate", "TURN THE CABINET SIDEWAYS");
  private readonly probe = el("div", "touch-probe");
  private readonly buttons: Button[];
  private readonly pointers = new Map<number, Hold>();
  /** The auto rule's answer: true on a coarse pointer at boot, then set by the last device used. */
  private auto = false;
  /** A trusted key or a gamepad was used this session. Until then OFF defers to the auto rule. */
  private physicalSeen = false;
  private asked = false;

  constructor(
    private readonly app: GameApp,
    cabinet: HTMLElement,
    screen: HTMLElement,
  ) {
    const mk = (name: string, bit: number, cls: string, text: string, round = true): Button => ({
      name,
      bit,
      el: el("div", `touch-btn ${cls}`, text),
      round,
    });
    const diamond = el("div", "touch-diamond");
    this.buttons = [
      mk("special", IN.SPECIAL, "touch-top", "SPC"),
      mk("attack", IN.ATTACK, "touch-west", "ATK"),
      mk("taunt", IN.TAUNT, "touch-east", "TNT"),
      mk("jump", IN.JUMP, "touch-bottom", "JMP"),
      mk("start", IN.START, "touch-wide", "START", false),
    ];
    for (const b of this.buttons.slice(0, 4)) diamond.appendChild(b.el);
    this.zone.append(this.ring, this.knob);
    this.left.append(this.pause, this.zone);
    this.right.append(this.buttons[4]!.el, diamond);
    this.left.hidden = true;
    this.right.hidden = true;
    cabinet.insertBefore(this.left, screen);
    cabinet.appendChild(this.right);
    document.body.append(this.message, this.probe);

    for (const g of [this.left, this.right]) {
      g.addEventListener("pointerdown", (e) => this.onDown(e));
      g.addEventListener("contextmenu", (e) => e.preventDefault());
    }
    window.addEventListener("pointermove", (e) => this.onMove(e));
    window.addEventListener("pointerup", (e) => this.onUp(e, false));
    window.addEventListener("pointercancel", (e) => this.onUp(e, true));
    window.addEventListener("blur", () => this.releaseAll());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.releaseAll();
    });

    // The show rules (auto): coarse primary pointer at boot, else the first touch pointer. A
    // trusted key or pad press hides it again, but only while the pad owns no player.
    const coarse = window.matchMedia?.("(pointer: coarse)");
    this.auto = coarse?.matches ?? false;
    window.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "touch" || this.auto) return;
      this.auto = true;
      this.evaluate();
    });
    window.addEventListener("keydown", (e) => {
      if (e.isTrusted) this.physical();
    });
    window.addEventListener("pointerup", (e) => {
      if (e.pointerType === "touch") this.immerse();
    });
    window.addEventListener("touchend", () => this.immerse());
    window.matchMedia?.("(orientation: portrait)")?.addEventListener?.("change", () => app.fit());
  }

  /**
   * Re-reads the setting and the auto rule, and shows or hides the pad. ON shows, AUTO follows
   * the auto rule, and OFF hides only once a keyboard or a gamepad has been used this session.
   */
  evaluate(): void {
    const mode = this.app.settings.touchControls;
    const want =
      mode === "on" ? true : mode === "auto" ? this.auto : this.auto && !this.physicalSeen;
    if (want === this.shown) return;
    this.shown = want;
    this.left.hidden = !want;
    this.right.hidden = !want;
    this.releaseAll();
    if (!want) {
      const slot = this.app.input.slots.findIndex((s) => s?.kind === "touch");
      if (slot >= 0) this.app.input.release(slot);
    }
    this.app.fit();
  }

  /** Called after every input sample: a gamepad in a slot counts as a physical press. */
  afterSample(): void {
    if (this.app.input.holds("pad")) this.physical();
  }

  /** The safe-area insets in CSS px, read from a probe styled with env(). */
  insets(): { left: number; right: number; bottom: number } {
    const cs = getComputedStyle(this.probe);
    const px = (v: string) => Math.max(0, parseFloat(v) || 0);
    return { left: px(cs.paddingLeft), right: px(cs.paddingRight), bottom: px(cs.paddingBottom) };
  }

  /** Called by GameApp.fit after it sizes the canvas. Shows the rotate message in portrait. */
  layout(width: number, height: number): void {
    const rotate = this.shown && height > width;
    if (rotate === this.rotate) return;
    this.rotate = rotate;
    this.message.classList.toggle("on", rotate);
    if (rotate) {
      this.releaseAll();
      this.app.scene?.interrupt?.();
    }
  }

  status(): TouchStatus {
    const controls: Record<string, Rect> = {};
    if (this.shown) {
      controls.stick = rect(this.ring);
      controls.pause = rect(this.pause);
      for (const b of this.buttons) controls[b.name] = rect(b.el);
    }
    return {
      shown: this.shown,
      rotate: this.rotate,
      bits: this.bits,
      canvas: rect(this.app.app.canvas),
      controls,
    };
  }

  // ------------------------------------------------------------------ rules

  /** A trusted key or a gamepad in a slot. Ignored while the pad owns a player. */
  private physical(): void {
    if (this.app.input.holds("touch")) return;
    this.physicalSeen = true;
    if (this.auto && this.app.settings.touchControls === "auto") this.auto = false;
    this.evaluate();
  }

  /** Best effort on the first touch: fullscreen, then a landscape lock. Both fail silently. */
  private immerse(): void {
    if (this.asked || !this.shown) return;
    this.asked = true;
    try {
      const root = document.documentElement;
      const lock = () => {
        const o = screen.orientation as unknown as { lock?: (t: string) => Promise<void> };
        return o.lock?.("landscape");
      };
      Promise.resolve(root.requestFullscreen?.({ navigationUI: "hide" }))
        .then(lock)
        .catch(() => {});
    } catch {
      /* no fullscreen here */
    }
  }

  // ------------------------------------------------------------------ pointers

  private onDown(e: PointerEvent): void {
    if (!this.shown || this.rotate) return;
    e.preventDefault();
    const x = e.clientX;
    const y = e.clientY;
    let hold: Hold = { kind: "none" };
    if (this.left.contains(e.target as Node)) {
      if (this.inside(this.pause, x, y)) hold = { kind: "pause" };
      else {
        const z = this.zone.getBoundingClientRect();
        const R = STICK_RADIUS;
        const ox = Math.max(z.left + R, Math.min(z.right - R, x));
        const oy = Math.max(z.top + R, Math.min(z.bottom - R, y));
        hold = { kind: "stick", ox, oy, bits: 0 };
        this.ring.style.left = `${ox - z.left}px`;
        this.ring.style.top = `${oy - z.top}px`;
      }
    } else {
      const bit = this.hit(x, y);
      hold = bit ? { kind: "button", bit } : { kind: "none" };
    }
    this.pointers.set(e.pointerId, hold);
    this.update(e.pointerId, x, y);
  }

  private onMove(e: PointerEvent): void {
    if (this.pointers.has(e.pointerId)) this.update(e.pointerId, e.clientX, e.clientY);
  }

  private onUp(e: PointerEvent, cancel: boolean): void {
    const hold = this.pointers.get(e.pointerId);
    if (!hold) return;
    this.pointers.delete(e.pointerId);
    if (hold.kind === "stick") this.restStick();
    if (hold.kind === "pause" && !cancel && this.inside(this.pause, e.clientX, e.clientY))
      this.app.scene?.escape?.();
    this.apply();
  }

  /** Re-reads one pointer's control from its position and rebuilds the mask. */
  private update(id: number, x: number, y: number): void {
    const hold = this.pointers.get(id);
    if (!hold) return;
    if (hold.kind === "stick") {
      const R = STICK_RADIUS;
      let dx = x - hold.ox;
      let dy = y - hold.oy;
      hold.bits = stickBits(dx, dy, R, hold.bits);
      const d2 = dx * dx + dy * dy;
      if (d2 > R * R) {
        const k = R / Math.sqrt(d2);
        dx *= k;
        dy *= k;
      }
      const z = this.zone.getBoundingClientRect();
      this.knob.style.left = `${hold.ox + dx - z.left}px`;
      this.knob.style.top = `${hold.oy + dy - z.top}px`;
    } else if (hold.kind === "button") {
      // A thumb can roll from one button to the next, or off every button.
      hold.bit = this.hit(x, y);
    }
    this.apply();
  }

  private apply(): void {
    let bits = 0;
    for (const h of this.pointers.values()) {
      if (h.kind === "stick") bits |= h.bits;
      else if (h.kind === "button") bits |= h.bit;
    }
    this.bits = bits;
    this.app.input.setTouch(bits);
    for (const b of this.buttons) b.el.classList.toggle("on", (bits & b.bit) !== 0);
    this.ring.classList.toggle("on", (bits & (IN.UP | IN.DOWN | IN.LEFT | IN.RIGHT)) !== 0);
  }

  private releaseAll(): void {
    if (!this.pointers.size && !this.bits) return;
    this.pointers.clear();
    this.restStick();
    this.apply();
  }

  private restStick(): void {
    this.ring.style.left = "";
    this.ring.style.top = "";
    this.knob.style.left = "";
    this.knob.style.top = "";
  }

  /** The bit of the button under a point, or 0. Round buttons are hit by distance. */
  private hit(x: number, y: number): number {
    let best = 0;
    let bestD = Infinity;
    for (const b of this.buttons) {
      const r = b.el.getBoundingClientRect();
      if (b.round) {
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(x - cx, y - cy);
        const reach = r.width / 2 + SLACK;
        if (d <= reach && d < bestD) {
          best = b.bit;
          bestD = d;
        }
      } else if (this.inside(b.el, x, y)) return b.bit;
    }
    return best;
  }

  private inside(node: HTMLElement, x: number, y: number): boolean {
    const r = node.getBoundingClientRect();
    return (
      x >= r.left - SLACK && x <= r.right + SLACK && y >= r.top - SLACK && y <= r.bottom + SLACK
    );
  }
}
