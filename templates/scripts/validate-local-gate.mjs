import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(repoRoot, "scripts", "validate-local-gate.ps1");
const args = process.argv.slice(2);
const normalizedArgs = args[0] === "--" ? args.slice(1) : args;

function runPowerShell(command) {
  return spawnSync(
    command,
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...normalizedArgs],
    {
      cwd: repoRoot,
      stdio: "inherit"
    }
  );
}

function explainMissingPowerShell(command, error) {
  const fallback = process.platform === "win32" && command === "pwsh" ? " Intentando fallback con powershell.exe." : "";
  console.error(`No se pudo ejecutar ${command}: ${error.message}.${fallback}`);
}

let result = runPowerShell("pwsh");

if (result.error) {
  explainMissingPowerShell("pwsh", result.error);
  if (process.platform === "win32") {
    result = runPowerShell("powershell.exe");
  }
}

if (result.error) {
  console.error(`No se pudo ejecutar PowerShell: ${result.error.message}`);
  console.error("Instala PowerShell 7 (pwsh) o verifica que PowerShell este disponible en PATH.");
  process.exit(1);
}

process.exit(result.status ?? 1);
