/**
 * Deployment to the GKE cluster that serves Dean's other web games, in the same shape as
 * Marble Melancholy: a static nginx image, a Deployment and Service, and an HTTPRoute on the
 * shared Gateway.
 *
 *   tools deploy          build + push the image, apply deploy/k8s/bootleg.yaml, wait for rollout
 *   tools deploy-status   rollout, route, Gateway and HTTPS state
 *
 * Deploys need the user's approval every time (see CLAUDE.md). Env overrides: GCLOUD,
 * KUBE_CONTEXT, IMAGE_REPO, BOOTLEG_HOST.
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../lib/paths";

const PROJECT = "example-gcp-project";
const HOST = process.env.BOOTLEG_HOST ?? "bootleg.llmgag.world";
const NAMESPACE = "bootleg-brawl";
const CONTEXT = process.env.KUBE_CONTEXT ?? "gke_example-gcp-project_us-central1-a_cluster-1";
const IMAGE_REPO =
  process.env.IMAGE_REPO ?? `us-central1-docker.pkg.dev/${PROJECT}/bootleg-brawl/web`;

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

const kubectl = (...args: string[]) => ["--context", CONTEXT, "--request-timeout=30s", ...args];

function imageTag(): string {
  const sha = tryOut("git", ["rev-parse", "--short", "HEAD"]) ?? "nogit";
  if ((tryOut("git", ["status", "--porcelain"]) ?? "") === "") return sha;
  return `${sha}-dirty-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}`;
}

export function deployCommand(): number {
  if (!existsSync(join(ROOT, "dist/index.html"))) throw new Error("dist/ missing; run pnpm build");
  const image = `${IMAGE_REPO}:${imageTag()}`;
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
  console.log(`\n▶ Applying ${file} to ${CONTEXT}`);
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
