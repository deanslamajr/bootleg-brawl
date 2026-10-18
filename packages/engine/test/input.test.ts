// The remappable action map: a key bound with setKey drives its action, and a key moves out of
// the action it had before. The touch device: one slot, a latch for short taps, and the same
// enabled and injected rules as the other devices.

import { describe, expect, it } from "vitest";
import { IN } from "../src/sim/types";
import { InputManager, keyName } from "../src/input/index";

function keydown(target: EventTarget, code: string): void {
  target.dispatchEvent(Object.assign(new Event("keydown"), { code, repeat: false }));
}

describe("input remapping", () => {
  it("binds a key to an action and moves it out of its old action", () => {
    const target = new EventTarget();
    const input = new InputManager(target as unknown as Window);
    keydown(target, "KeyH");
    expect(input.sample()[0]! & IN.ATTACK).toBe(0);

    expect(input.setKey(0, "attack", "KeyH")).toBeNull();
    expect(input.sample()[0]! & IN.ATTACK).toBe(IN.ATTACK);
    expect(input.keys[0]!.attack).toEqual(["KeyH"]);

    expect(input.setKey(0, "jump", "KeyH")).toEqual({ layout: 0, action: "attack" });
    expect(input.keys[0]!.attack).not.toContain("KeyH");
    expect(input.keys[0]!.jump).toEqual(["KeyH"]);
  });

  it("removes a key from the other layout", () => {
    const input = new InputManager(new EventTarget() as unknown as Window);
    expect(input.setKey(0, "attack", "Comma")).toEqual({ layout: 1, action: "attack" });
    expect(input.keys[1]!.attack).toEqual(["Numpad1"]);
  });

  it("returns the last key once", () => {
    const target = new EventTarget();
    const input = new InputManager(target as unknown as Window);
    keydown(target, "KeyQ");
    expect(input.takeLastKey()).toBe("KeyQ");
    expect(input.takeLastKey()).toBeNull();
  });

  it("names keys for the screen", () => {
    expect(keyName("KeyH")).toBe("H");
    expect(keyName("Digit7")).toBe("7");
    expect(keyName("Numpad1")).toBe("NUM 1");
    expect(keyName("ArrowLeft")).toBe("←");
  });
});

describe("touch device", () => {
  function make(): InputManager {
    return new InputManager(new EventTarget() as unknown as Window);
  }

  it("is idle with no input", () => {
    const input = make();
    expect(input.sample()[0]).toBe(0);
    expect(input.slots[0]).toBeNull();
  });

  it("takes the first free slot on the first press", () => {
    const input = make();
    input.setTouch(IN.ATTACK);
    expect(input.sample()[0]! & IN.ATTACK).toBe(IN.ATTACK);
    expect(input.slots[0]?.kind).toBe("touch");
    expect(input.deviceLabel(0)).toBe("TOUCH");
    expect(input.holds("touch")).toBe(true);
  });

  it("latches a tap that starts and ends between two samples", () => {
    const input = make();
    input.setTouch(IN.JUMP);
    input.setTouch(0);
    expect(input.sample()[0]! & IN.JUMP).toBe(IN.JUMP);
    expect(input.sample()[0]).toBe(0);
  });

  it("reads 0 while disabled", () => {
    const input = make();
    input.setTouch(IN.ATTACK);
    input.sample();
    input.enabled = false;
    expect(input.sample()[0]).toBe(0);
    input.enabled = true;
    expect(input.sample()[0]! & IN.ATTACK).toBe(IN.ATTACK);
  });

  it("lets an injected value win over the touch bits", () => {
    const input = make();
    input.setTouch(IN.ATTACK);
    input.sample();
    input.injected[0] = IN.JUMP;
    expect(input.sample()[0]).toBe(IN.JUMP);
    input.injected[0] = null;
    expect(input.sample()[0]).toBe(IN.ATTACK);
  });

  it("never takes a second slot", () => {
    const input = make();
    input.setTouch(IN.ATTACK);
    input.sample();
    input.setTouch(IN.JUMP);
    input.sample();
    input.setTouch(IN.START | IN.RIGHT);
    input.sample();
    expect(input.slots.filter((s) => s?.kind === "touch")).toHaveLength(1);
    expect(input.slots[1]).toBeNull();
  });

  it("frees its slot on release", () => {
    const input = make();
    input.setTouch(IN.ATTACK);
    input.sample();
    input.setTouch(0);
    input.sample();
    input.release(0);
    expect(input.holds("touch")).toBe(false);
    expect(input.sample()[0]).toBe(0);
    expect(input.slots[0]).toBeNull();
  });
});
