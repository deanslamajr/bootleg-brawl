/**
 * Deployment to the owner's GKE cluster: a static nginx image, a Deployment and Service, and an
 * HTTPRoute on the cluster's shared Gateway.
 *
 *   tools deploy          build + push the image, apply deploy/k8s/bootleg.yaml, wait for rollout
 *   tools deploy-status   rollout, route, Gateway and HTTPS state
 *
 * Deploys need the user's approval every time (see CLAUDE.md). KUBE_CONTEXT and IMAGE_REPO come
 * from the environment or from a git-ignored `.env.deploy` at the repository root (D63), so no
 * cloud identifier is committed. BOOTLEG_HOST overrides the public host.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/paths";

const HOST = process.env.BOOTLEG_HOST ?? "bootleg.llmgag.world";
const NAMESPACE = "bootleg-brawl";

/** KEY=VALUE lines from `.env.deploy`, read on first use. */
let deployFile: Record<string, string> | null = null;

function setting(name: "KUBE_CONTEXT" | "IMAGE_REPO"): string {
  if (!deployFile) {
    deployFile = {};
    const path = join(ROOT, ".env.deploy");
    if (existsSync(path))
      for (const line of readFileSync(path, "utf8").split("\n")) {
        const m = /^\s*([A-Z_]+)\s*=\s*"?([^"]*)"?\s*$/.exec(line);
        if (m) deployFile[m[1]!] = m[2]!;
      }
  }
  const value = process.env[name] ?? deployFile[name];
  if (!value)
    throw new Error(
      `${name} is not set. Put it in .env.deploy at the repository root (git ignores it) or in the environment.`,
    );
  return value;
}

function out(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" }).trim();
}

function run(cmd: string, args: string[], input?: string): void {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    input,
    stdio: [input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited with ${r.status}`);
}

function tryOut(cmd: string, args: string[]): string | null {
  try {
    return out(cmd, args);
  } catch {
    return null;
  }
}

const kubectl = (...args: string[]) => [
  "--context",
  setting("KUBE_CONTEXT"),
  "--request-timeout=30s",
  ...args,
];

function imageTag(): string {
  const sha = tryOut("git", ["rev-parse", "--short", "HEAD"]) ?? "nogit";
  if ((tryOut("git", ["status", "--porcelain"]) ?? "") === "") return sha;
  return `${sha}-dirty-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

export function deployCommand(): number {
  if (!existsSync(join(ROOT, "dist/index.html"))) throw new Error("dist/ missing; run pnpm build");
  const image = `${setting("IMAGE_REPO")}:${imageTag()}`;
  console.log(`\n▶ Building and pushing ${image}`);
  run("docker", [
    "buildx",
    "build",
    "--platform",
    "linux/amd64",
    "--provenance=false",
    "--sbom=false",
    "--tag",
    image,
    "--push",
    ".",
  ]);
  const file = "deploy/k8s/bootleg.yaml";
  const manifest = readFileSync(join(ROOT, file), "utf8");
  if (!manifest.includes("image: IMAGE")) throw new Error(`image placeholder missing in ${file}`);
  console.log(`\n▶ Applying ${file} to ${setting("KUBE_CONTEXT")}`);
  run(
    "kubectl",
    kubectl("apply", "-f", "-"),
    manifest.replace("image: IMAGE", `image: ${image}`).replaceAll("HOSTNAME", HOST),
  );
  run(
    "kubectl",
    kubectl("-n", NAMESPACE, "rollout", "status", "deployment/bootleg", "--timeout=180s"),
  );
  console.log(`\nDeployed ${image}. Run pnpm deploy:status to check the route and certificate.`);
  return 0;
}

export async function deployStatusCommand(): Promise<number> {
  const line = (k: string, v: string) => console.log(`${k.padEnd(12)} ${v}`);
  line(
    "deployment",
    tryOut(
      "kubectl",
      kubectl(
        "-n",
        NAMESPACE,
        "get",
        "deployment/bootleg",
        "-o",
        "jsonpath={.status.readyReplicas}/{.spec.replicas} {.spec.template.spec.containers[0].image}",
      ),
    ) ?? "not found",
  );
  line(
    "route",
    tryOut(
      "kubectl",
      kubectl(
        "-n",
        NAMESPACE,
        "get",
        "httproute/bootleg",
        "-o",
        "jsonpath={range .status.parents[*].conditions[*]}{.type}={.status} {end}",
      ),
    ) || "no status",
  );
  line(
    "gateway",
    tryOut(
      "kubectl",
      kubectl(
        "-n",
        "default",
        "get",
        "gateway/external-https",
        "-o",
        'jsonpath={.status.conditions[?(@.type=="Programmed")].status}',
      ),
    ) ?? "unknown",
  );
  try {
    const res = await fetch(`https://${HOST}/healthz`);
    line("https", `${res.status} ${HOST}`);
  } catch (e) {
    line("https", `unreachable: ${(e as Error).message}`);
  }
  return 0;
}
