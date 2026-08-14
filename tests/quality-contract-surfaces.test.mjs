// ---------------------------------------------------------------------------
// P6 (ADR 0007): quality-contract.yaml generado desde config.surfaces, no
// inventado. Antes, el template traia `apps/api`/`apps/web` como literales
// PROPIOS, desconectados de config.surfaces: un consumidor real (el piloto,
// dominio en packages/checkout-core) terminaba con un contrato que declaraba
// superficies que no existen en su disco, y checkSurfaces las bloqueaba
// SIEMPRE por "surface-path-unresolved" sin importar que tan bien configurado
// estuviera config.json.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { loadQualityContract, checkSurfaces } from "../src/quality-adjudicate.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-quality-surfaces-"));

function run(args) {
  return execFileSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// --- 1. install de fabrica: el contrato refleja el default de config -------
const greenfield = path.join(tempRoot, "greenfield");
fs.mkdirSync(greenfield, { recursive: true });
run(["install", "--target", greenfield, "--mode", "greenfield", "--project-name", "Demo", "--json"]);

// El instalador YA NO escribe superficies de ejemplo. Antes dejaba `apps/api`
// y `apps/web`, y en un repo con otro layout eso no era un ejemplo sino
// configuracion activa: gates vacuos sobre paths inexistentes y sujeto de
// firma sobre el arbol vacio, sin que nada lo dijera. Un repo recien instalado
// declara CERO superficies y `doctor` lo marca como error.
const installedContract = YAML.parse(fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8"));
assert.deepEqual(installedContract.surfaces, [], "install no inventa superficies");

const installedConfig = JSON.parse(fs.readFileSync(path.join(greenfield, ".sdlc", "config.json"), "utf8"));
assert.deepEqual(installedConfig.surfaces, []);
assert.deepEqual(
  Object.values(installedConfig.stack),
  [null, null, null, null, null],
  "el stack se instala en null, no con placeholders <BACKEND_STACK>"
);

let doctorPayload;
try {
  doctorPayload = JSON.parse(run(["doctor", "--target", greenfield, "--json"]));
} catch (error) {
  doctorPayload = JSON.parse(error.stdout.toString());
}
assert.ok(
  doctorPayload.findings.some((finding) => finding.code === "config-surfaces-empty" && finding.level === "error"),
  `doctor tiene que marcar el repo a medio configurar: ${JSON.stringify(doctorPayload.findings.map((f) => f.code))}`
);

// --- 2. el piloto real: superficie propia, no apps/api/apps/web ------------
const config = JSON.parse(fs.readFileSync(path.join(greenfield, ".sdlc", "config.json"), "utf8"));
config.surfaces = [
  { id: "checkout-core", path: "packages/checkout-core", owner: "payments-agent", tier: "core", moneyPath: true }
];
fs.writeFileSync(path.join(greenfield, ".sdlc", "config.json"), JSON.stringify(config, null, 2), "utf8");

const upgraded = JSON.parse(run(["upgrade", "--target", greenfield, "--accept-managed", ".sdlc/config.json", "--json"]));
assert.equal(upgraded.status, "ok", JSON.stringify(upgraded));

const regenerated = YAML.parse(fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8"));
assert.equal(regenerated.surfaces.length, 1);
assert.equal(regenerated.surfaces[0].id, "checkout-core");
assert.equal(regenerated.surfaces[0].path, "packages/checkout-core");
assert.equal(regenerated.surfaces[0].tier, "core");
assert.equal(regenerated.surfaces[0].money_path, true);
assert.equal(regenerated.surfaces[0].has_ui, false);
assert.ok(
  !regenerated.surfaces.some((s) => s.path === "apps/api" || s.path === "apps/web"),
  "las superficies inventadas del template no deben sobrevivir a una superficie real declarada en config"
);

// El contrato regenerado sigue siendo valido y, si la superficie real existe
// en disco, checkSurfaces no la marca como fantasma.
fs.mkdirSync(path.join(greenfield, "packages", "checkout-core"), { recursive: true });
fs.writeFileSync(path.join(greenfield, "packages", "checkout-core", "index.js"), "export const x = 1;\n", "utf8");
const loaded = loadQualityContract(greenfield);
assert.ok(loaded.ok, JSON.stringify(loaded));
assert.equal(checkSurfaces(greenfield, loaded.contract).length, 0);

// --- 3. sin superficies declaradas: `[]` explicito, no un YAML invalido ----
config.surfaces = [];
fs.writeFileSync(path.join(greenfield, ".sdlc", "config.json"), JSON.stringify(config, null, 2), "utf8");
run(["upgrade", "--target", greenfield, "--accept-managed", ".sdlc/config.json", "--json"]);
const empty = YAML.parse(fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8"));
assert.deepEqual(empty.surfaces, []);

console.log("quality-contract-surfaces: PASS");

// --- 4. inyeccion YAML via project.name: `upgrade` no valida config antes de
// renderizar (a diferencia de `install`), y `interpolate()` sustituye
// `{{project.name}}` como texto crudo dentro de quality-contract.yaml sin
// escapar. Antes de este fix, un `project.name` con un salto de linea
// inyectaba una key YAML real (`enforcement: block`) ANTES de la legitima --
// el mismo archivo que spec-boundary-guard protege de ediciones directas,
// alcanzado por `.sdlc/config.json`, que spec-boundary-guard NO protege.
// PoC reproducido contra el CLI real antes del fix (schema pattern +
// validateConfigShape en commandUpgrade).
const beforeInjection = fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8");
config.project.name = "MiProyecto\nenforcement: block\n#";
fs.writeFileSync(path.join(greenfield, ".sdlc", "config.json"), JSON.stringify(config, null, 2), "utf8");

let injectionResult;
try {
  run(["upgrade", "--target", greenfield, "--accept-managed", ".sdlc/config.json", "--json"]);
  injectionResult = { threw: false };
} catch (error) {
  injectionResult = { threw: true, stdout: error.stdout?.toString() ?? "" };
}
assert.equal(injectionResult.threw, true, "un project.name con salto de linea debe bloquear el upgrade, no aplicarlo");
const rejection = JSON.parse(injectionResult.stdout);
assert.equal(rejection.status, "error");
assert.ok(
  rejection.errors.some((e) => e.includes("/project/name")),
  "el rechazo debe senalar el campo exacto, no un error generico"
);
assert.equal(
  fs.readFileSync(path.join(greenfield, "quality-contract.yaml"), "utf8"),
  beforeInjection,
  "el contrato protegido no debe haber cambiado: el rechazo tiene que pasar ANTES de renderizar, no despues"
);

console.log("quality-contract-surfaces injection guard: PASS");

// --- Divergencia entre las DOS declaraciones de superficies -----------------
// Las superficies viven en `.sdlc/config.json` y en `quality-contract.yaml`, y
// el arbitro y la firma leen SOLO el contrato. En manga-translator-mvp se
// corrigieron las superficies fantasma del config y el KPI siguio sin cumplirse
// y la firma siguio hueca, porque las mismas fantasmas seguian en el contrato.
const driftTarget = path.join(tempRoot, "drift");
fs.mkdirSync(path.join(driftTarget, ".sdlc"), { recursive: true });
fs.mkdirSync(path.join(driftTarget, "src"), { recursive: true });
fs.writeFileSync(path.join(driftTarget, "src", "index.js"), "export const z = 1;\n", "utf8");

function writeDriftFiles(configSurfaces, contractSurfaces) {
  fs.writeFileSync(
    path.join(driftTarget, ".sdlc", "config.json"),
    JSON.stringify({ schemaVersion: 1, project: { name: "Drift", slug: "drift" }, surfaces: configSurfaces }, null, 2),
    "utf8"
  );
  fs.writeFileSync(
    path.join(driftTarget, "quality-contract.yaml"),
    YAML.stringify({ version: 1, enforcement: "observe", tiers: { core: { description: "unico" } }, surfaces: contractSurfaces, probes: [], gates: [] }),
    "utf8"
  );
}

writeDriftFiles(
  [{ id: "app", path: "src", owner: "web-agent", tier: "core" }],
  [{ id: "app", path: "apps/web", tier: "core" }]
);
const drifted = checkSurfaces(driftTarget, loadQualityContract(driftTarget).contract);
const divergence = drifted.find((finding) => finding.code === "surface-declaration-divergent");
assert.ok(divergence, `se esperaba surface-declaration-divergent: ${JSON.stringify(drifted)}`);
assert.equal(divergence.level, "warning", "escalera de adopcion: avisa, no rompe pipelines sanos al actualizar");
assert.deepEqual(divergence.onlyInConfig, ["app@src"]);
assert.deepEqual(divergence.onlyInContract, ["app@apps/web"]);

// Sincronizadas: ni un hallazgo. Y `src/` existe, asi que tampoco fantasma.
writeDriftFiles([{ id: "app", path: "src", owner: "web-agent", tier: "core" }], [{ id: "app", path: "src", tier: "core" }]);
assert.deepEqual(checkSurfaces(driftTarget, loadQualityContract(driftTarget).contract), []);

// Sin superficies en el config no hay contra que cruzar: no se inventa nada.
writeDriftFiles([], [{ id: "app", path: "src", tier: "core" }]);
assert.deepEqual(checkSurfaces(driftTarget, loadQualityContract(driftTarget).contract), []);

console.log("quality-contract-surfaces declaration drift: PASS");
