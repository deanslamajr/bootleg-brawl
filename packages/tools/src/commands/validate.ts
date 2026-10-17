import { createRegistry } from "@bb/mechanics";
import { validateRepo } from "../lib/validate";

/** `tools validate [path-filter] [--flags=a,b]`: one pass/fail with line-level errors. */
export function validateCommand(args: string[]): number {
  const flags =
    args
      .find((a) => a.startsWith("--flags="))
      ?.slice(8)
      .split(",") ?? [];
  const only = args.find((a) => !a.startsWith("--"))?.replace(/^\.\//, "");
  const r = validateRepo(createRegistry(flags), only);
  for (const w of r.warnings) console.warn(`warning: ${w}`);
  for (const e of r.errors) console.error(`error: ${e}`);
  console.log(
    `${r.errors.length ? "FAIL" : "PASS"}: ${r.files} files, ${r.errors.length} error(s), ${r.warnings.length} warning(s)`,
  );
  return r.errors.length ? 1 : 0;
}
