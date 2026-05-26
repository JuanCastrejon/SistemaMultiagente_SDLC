import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "validate-local-gate.ps1");
const args = process.argv.slice(2);
const normalizedArgs = args[0] === "--" ? args.slice(1) : args;

const result = spawnSync(
  "pwsh",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...normalizedArgs],
  {
    cwd: repoRoot,
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);
