import js from "@eslint/js";
import tseslint from "typescript-eslint";

// Determinism rules (CLAUDE.md invariant 1): the sim may not read clocks or unseeded randomness.
const deterministicFiles = [
  "packages/engine/src/sim/**/*.ts",
  "packages/engine/src/math/**/*.ts",
  "packages/engine/src/ecs/**/*.ts",
  "packages/engine/src/content/**/*.ts",
  "packages/engine/src/modules/**/*.ts",
  "packages/mechanics/*/src/**/*.ts",
];

// Invariant 2 (CLAUDE.md): the renderer, audio, input and app read the sim and never write it.
// The sandbox is left out on purpose: it is a tool that edits a paused sim. This is a tripwire,
// not a proof: an alias such as `const c = sim.c` followed by a write escapes it (D48).
const readerFiles = [
  "apps/game/src/**/*.ts",
  "packages/engine/src/render/**/*.ts",
  "packages/engine/src/audio/**/*.ts",
  "packages/engine/src/input/**/*.ts",
];
const READER_MESSAGE = "The renderer, audio, input and app read the sim and never write to it.";
const SIM_STATE = "/^(c|g|world|rng|inputs|events|prevX|prevY|prevZ|segController)$/";
const SIM_MUTATORS =
  "/^(enterState|spawnActor|spawnPlayer|spawnPickup|spawnProp|despawn|restore|emit|text|sfx|" +
  "addScore|payCost|queueWave|hitLogPush)$/";
const ARRAY_MUTATORS = "/^(push|pop|shift|unshift|splice|sort|reverse|fill|set|copyWithin)$/";

/**
 * Selectors for `root` (an AST path) being `sim.X...`, `<obj>.sim.X...` or the same with a
 * non-null `sim!`, where X is a state field.
 */
function simChain(root) {
  const out = [];
  for (let depth = 0; depth < 4; depth++) {
    const at = root + ".object".repeat(depth);
    for (const sim of ["name", "property.name", "expression.name", "expression.property.name"])
      out.push(`[${at}.property.name=${SIM_STATE}][${at}.object.${sim}='sim']`);
  }
  return out;
}

const readerSelectors = [
  ...simChain("left").map((c) => `AssignmentExpression${c}`),
  ...simChain("argument").map((c) => `UpdateExpression${c}`),
  ...simChain("argument").map((c) => `UnaryExpression[operator='delete']${c}`),
  ...simChain("callee.object").map(
    (c) => `CallExpression[callee.property.name=${ARRAY_MUTATORS}]${c}`,
  ),
  ...["name", "property.name", "expression.name", "expression.property.name"].map(
    (sim) => `CallExpression[callee.property.name=${SIM_MUTATORS}][callee.object.${sim}='sim']`,
  ),
].map((selector) => ({ selector, message: READER_MESSAGE }));

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "generated/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
  {
    files: deterministicFiles,
    ignores: ["packages/mechanics/*/src/render.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "The sim may not read the clock. Use the tick counter." },
        { name: "performance", message: "The sim may not read the clock. Use the tick counter." },
        { name: "setTimeout", message: "The sim is stepped by the tick, not by timers." },
        { name: "setInterval", message: "The sim is stepped by the tick, not by timers." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Use the seeded PRNG in sim.rng." },
        { object: "Math", property: "sin", message: "Use the integer lookup in math/fixed.ts." },
        { object: "Math", property: "cos", message: "Use the integer lookup in math/fixed.ts." },
        { object: "Math", property: "tan", message: "Not deterministic across engines." },
        { object: "Math", property: "atan2", message: "Use fixed.ts helpers." },
        { object: "Math", property: "pow", message: "Not deterministic across engines." },
        { object: "Math", property: "exp", message: "Not deterministic across engines." },
        { object: "Math", property: "log", message: "Not deterministic across engines." },
        { object: "Math", property: "sqrt", message: "Use isqrt in fixed.ts." },
        { object: "Math", property: "hypot", message: "Use isqrt in fixed.ts." },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "BinaryExpression[operator='**']",
          message: "Not deterministic across engines.",
        },
      ],
    },
  },
  {
    files: readerFiles,
    rules: { "no-restricted-syntax": ["error", ...readerSelectors] },
  },
);
