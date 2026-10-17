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
);
