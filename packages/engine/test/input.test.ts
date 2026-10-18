// The remappable action map: a key bound with setKey drives its action, and a key moves out of
// the action it had before.

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
