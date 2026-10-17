import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (three levels above this file). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
export const CONTENT = join(ROOT, "content");
export const GENERATED = join(ROOT, "generated");
/** Served as the Vite public dir by both apps. */
export const PUBLIC = join(GENERATED, "public");
