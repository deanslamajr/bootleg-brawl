import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildRigs } from "../rig/poses";
import { CONTENT } from "../lib/paths";

export function genRigs(): void {
  for (const rig of buildRigs()) {
    const file = join(CONTENT, "rigs", `${rig.id}.rig.json`);
    writeFileSync(file, JSON.stringify(rig) + "\n");
    console.log(`wrote ${file} (${Object.keys(rig.poses).length} poses)`);
  }
}
