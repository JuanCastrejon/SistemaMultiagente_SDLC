// ---------------------------------------------------------------------------
// `seed_only`: los ficheros que el motor escribe una vez y despues son del host.
//
// El defecto que cierra esta categoria se midio en un consumidor con un mes de
// operacion: `doctor` devolvia 157 hallazgos y 72 eran
// `managed-file-override-stale` sobre ficheros de ESTADO VIVO —current-slice.md,
// open-risks.md, active-slices.yaml, phase-status.yaml, AGENTS.md—. Cambian
// cada sesion por diseño, asi que cada edicion legitima los volvia stale.
//
// El coste real no era el ruido: era que un control cuyas alertas nadie puede
// cerrar enseña a ignorar `doctor` entero. En ese consumidor habia UN
// `managed-file-drift` de verdad —`quality-contract.yaml`, el unico con riesgo
// de clobber— enterrado bajo los 72 inertes. Por eso el caso 5 comprueba que
// un fichero `managed` SIGUE reportando drift: si la categoria nueva tambien
// callara esos, habria cambiado un control inutil por uno ciego.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { seedOnlyTargets } from "../src/template-loader.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.VAULT_PATH;
delete CLEAN_ENV.MEMORY_WORKSPACE;

function newRepo(name) {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-seed-${name}-`)), "consumidor");
  fs.mkdirSync(target, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: target });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
  fs.writeFileSync(path.join(target, "a.txt"), "uno\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: target });
  execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: target });
  execFileSync("node", [cli, "install", "--target", target, "--mode", "legacy", "--project-name", name, "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: CLEAN_ENV
  });
  return target;
}

function sdlc(target, args) {
  try {
    return JSON.parse(
      execFileSync("node", [cli, ...args, "--target", target, "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        env: CLEAN_ENV
      })
    );
  } catch (error) {
    // doctor y upgrade salen con codigo != 0 cuando hay hallazgos o conflicto:
    // el payload sigue siendo el resultado, no un fallo del test.
    if (error.stdout) return JSON.parse(error.stdout);
    throw error;
  }
}

const SEMILLA = ".github/agent-state/current-slice.md";
const GESTIONADO = ".github/agent-state/phase-graph.yaml";

function hallazgosDe(doctor, filePath) {
  return (doctor.findings ?? []).filter((f) => f.path === filePath);
}

// --- 1. la categoria esta declarada y cubre el estado vivo medido ----------
{
  const seeds = seedOnlyTargets();
  for (const esperado of [
    "AGENTS.md",
    "indice-operativo.md",
    ".github/agent-state/current-slice.md",
    ".github/agent-state/open-risks.md",
    ".github/agent-state/active-slices.yaml",
    ".github/agent-state/phase-status.yaml"
  ]) {
    assert.ok(seeds.has(esperado), `${esperado} tiene que ser seed_only: es estado vivo del host`);
  }
  // Y NO puede tragarse lo que si es del motor: la topologia de fases F0-F17
  // es plantilla, y dejar de actualizarla seria congelar el metodo.
  assert.ok(!seeds.has(GESTIONADO), "phase-graph.yaml es del motor, no una semilla");
  assert.ok(!seeds.has("quality-contract.yaml"), "el contrato de calidad sigue gestionado: es el que tenia drift real");
}

console.log("seed-only categoria declarada: PASS");

// --- 2. install escribe la semilla, y el manifiesto la marca ---------------
{
  const target = newRepo("install");
  assert.ok(fs.existsSync(path.join(target, SEMILLA)), "la semilla se escribe al instalar");

  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".sdlc", "install-manifest.json"), "utf8"));
  const entrada = manifest.managedFiles.find((e) => e.path === SEMILLA);
  assert.equal(entrada?.seedOnly, true, "el manifiesto marca la semilla para que nadie compare su sha a mano");
  const gestionado = manifest.managedFiles.find((e) => e.path === GESTIONADO);
  assert.equal(gestionado?.seedOnly, undefined, "un gestionado no lleva la marca");
}

console.log("seed-only install y manifiesto: PASS");

// --- 3. editar una semilla NO produce hallazgo; editar un gestionado SI ----
{
  const target = newRepo("doctor");
  fs.writeFileSync(path.join(target, SEMILLA), "# slice de hoy\n\nSLICE-X, fase F2.\n", "utf8");
  fs.appendFileSync(path.join(target, GESTIONADO), "\n# editado a mano\n", "utf8");

  const doctor = sdlc(target, ["doctor"]);
  assert.deepEqual(
    hallazgosDe(doctor, SEMILLA),
    [],
    `editar estado vivo no puede generar hallazgo: ${JSON.stringify(hallazgosDe(doctor, SEMILLA))}`
  );

  const delGestionado = hallazgosDe(doctor, GESTIONADO);
  assert.equal(delGestionado.length, 1, "el gestionado editado sigue reportando");
  assert.equal(delGestionado[0].code, "managed-file-drift", JSON.stringify(delGestionado[0]));
}

console.log("seed-only doctor no compara sha: PASS");

// --- 4. upgrade no bloquea por una semilla, y no la sobreescribe ----------
{
  const target = newRepo("upgrade");
  const absoluta = path.join(target, SEMILLA);
  const contenidoDelHost = "# estado del host\n\nesto lo escribio el consumidor.\n";
  fs.writeFileSync(absoluta, contenidoDelHost, "utf8");

  const seco = sdlc(target, ["upgrade", "--dry-run"]);
  const rutasEnConflicto = (seco.conflicts ?? []).map((c) => c.path);
  assert.ok(!rutasEnConflicto.includes(SEMILLA), `una semilla no puede bloquear el upgrade: ${rutasEnConflicto.join(", ")}`);

  sdlc(target, ["upgrade"]);
  assert.equal(
    fs.readFileSync(absoluta, "utf8"),
    contenidoDelHost,
    "upgrade no puede pisar la semilla: es exactamente el clobber que esta categoria impide"
  );
}

console.log("seed-only upgrade no toca ni bloquea: PASS");

// --- 5. borrar una semilla se DICE, y se puede hacer definitivo -----------
// Callar la ausencia seria peor que el ruido que se acaba de quitar: sin
// `phase-status.yaml` no hay `resume`.
{
  const target = newRepo("borrada");
  fs.rmSync(path.join(target, SEMILLA));

  const doctor = sdlc(target, ["doctor"]);
  const hallazgo = hallazgosDe(doctor, SEMILLA)[0];
  assert.equal(hallazgo?.code, "seed-file-missing", JSON.stringify(doctor.findings?.slice(0, 5)));
  assert.equal(hallazgo?.level, "info", "borrar estado propio puede ser legitimo: no es un error");

  // Sin declararlo, el proximo install la vuelve a poner.
  execFileSync("node", [cli, "install", "--target", target, "--mode", "legacy", "--project-name", "borrada", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: CLEAN_ENV
  });
  assert.ok(fs.existsSync(path.join(target, SEMILLA)), "sin tombstone, la semilla vuelve");

  // Declarado con `deleted: true`, no vuelve — ni en install ni en upgrade.
  fs.rmSync(path.join(target, SEMILLA));
  fs.writeFileSync(
    path.join(target, ".sdlc", "overrides.yaml"),
    `version: 1\noverrides:\n  - path: ${SEMILLA}\n    sha256: null\n    deleted: true\n    reason: el host no usa este fichero\n`,
    "utf8"
  );
  execFileSync("node", [cli, "install", "--target", target, "--mode", "legacy", "--project-name", "borrada", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: CLEAN_ENV
  });
  assert.ok(!fs.existsSync(path.join(target, SEMILLA)), "con tombstone declarado, la semilla NO reaparece");
}

console.log("seed-only ausencia declarada: PASS");

// ---------------------------------------------------------------------------
// Mirrors de skills: derivados de la canonica LOCAL, no de la plantilla
//
// Segunda mitad del mismo defecto. Tras introducir `seed_only`, al consumidor
// medido le quedaban 71 `managed-file-override-stale` y **66 eran mirrors**:
// 22 skills x 3 entornos. Su bootstrap los regeneraba desde la canonica local
// y el motor los comparaba contra SU plantilla, asi que un consumidor que
// gobierna sus propias skills los tenia stale para siempre.
// ---------------------------------------------------------------------------

const MIRROR = ".claude/skills/backend-audit/SKILL.md";
const CANONICA = ".github/skills/backend-audit/SKILL.md";

// --- 6. editar la canonica y regenerar el mirror NO produce hallazgo -------
{
  const target = newRepo("mirror-ok");
  const canonica = path.join(target, CANONICA);
  const mirror = path.join(target, MIRROR);
  assert.ok(fs.existsSync(canonica) && fs.existsSync(mirror), "el motor instala canonica y mirror");

  const { buildSkillMirror } = await import("../src/render.js");
  const nuevaCanonica = `${fs.readFileSync(canonica, "utf8").trimEnd()}\n\n## Regla del consumidor\n\nAlgo que este repo añade.\n`;
  fs.writeFileSync(canonica, nuevaCanonica, "utf8");
  fs.writeFileSync(mirror, buildSkillMirror("backend-audit", nuevaCanonica), "utf8");

  const doctor = sdlc(target, ["doctor"]);
  assert.deepEqual(
    hallazgosDe(doctor, MIRROR),
    [],
    `un mirror regenerado desde su canonica no puede reportar: ${JSON.stringify(hallazgosDe(doctor, MIRROR))}`
  );
  // La canonica editada SI se reporta: esa divergencia con el motor es real y
  // se cierra aceptando un override o subiendo el cambio aguas arriba.
  assert.equal(hallazgosDe(doctor, CANONICA)[0]?.code, "managed-file-drift");
}

console.log("mirror derivado de la canonica: PASS");

// --- 7. editar la canonica y NO regenerar el mirror SI produce hallazgo ----
// La señal que no existia, y la que de verdad muerde: Claude Code carga
// `.claude/skills/`, no la canonica. Sin regenerar, el agente ejecuta la
// version vieja de la skill que el repo cree tener.
{
  const target = newRepo("mirror-stale");
  const canonica = path.join(target, CANONICA);
  fs.writeFileSync(canonica, `${fs.readFileSync(canonica, "utf8").trimEnd()}\n\n## Cambio sin bootstrap\n`, "utf8");

  const doctor = sdlc(target, ["doctor"]);
  const hallazgo = hallazgosDe(doctor, MIRROR)[0];
  assert.equal(hallazgo?.code, "skill-mirror-stale", JSON.stringify(hallazgosDe(doctor, MIRROR)));
  assert.equal(hallazgo?.skill, "backend-audit");
  assert.equal(hallazgo?.source, CANONICA, "el hallazgo dice contra que se comparo");
}

console.log("mirror sin regenerar se reporta: PASS");

// --- 8. el pie de procedencia NO decide -----------------------------------
// El pie lo escribe quien genera el mirror, y no todos hashean igual: el motor
// normaliza a LF y el bootstrap de un consumidor real hasheaba con CRLF. Con
// el pie en la comparacion, tres mirrors byte a byte correctos salian stale.
{
  const target = newRepo("mirror-pie");
  const mirror = path.join(target, MIRROR);
  const conPieFalso = fs
    .readFileSync(mirror, "utf8")
    .replace(/<!-- sdlc-source-sha256: [0-9a-f]+ -->/, "<!-- sdlc-source-sha256: 0000000000000000000000000000000000000000000000000000000000000000 -->");
  fs.writeFileSync(mirror, conPieFalso, "utf8");

  const doctor = sdlc(target, ["doctor"]);
  assert.deepEqual(
    hallazgosDe(doctor, MIRROR),
    [],
    "un sha de procedencia distinto con el cuerpo intacto no es un mirror stale"
  );
}

console.log("mirror: el pie no decide: PASS");

// --- 9. un mirror no bloquea el upgrade, y se regenera al final -----------
// Tercera puerta del mismo defecto. `doctor` ya trataba el mirror como
// derivado, pero `detectConflicts` —que es quien decide si `upgrade` bloquea—
// seguia comparandolo contra la version del motor. Medido en un consumidor
// real: 12 de 23 conflictos eran mirrors, todos falsos. No hay nada que
// fusionar en un fichero que se recalcula.
{
  const target = newRepo("upgrade-mirror");
  const canonica = path.join(target, CANONICA);
  const mirror = path.join(target, MIRROR);
  const propia = `${fs.readFileSync(canonica, "utf8").trimEnd()}\n\n## Regla propia del host\n`;
  fs.writeFileSync(canonica, propia, "utf8");

  const seco = sdlc(target, ["upgrade", "--dry-run"]);
  const rutas = (seco.conflicts ?? []).map((c) => c.path);
  assert.ok(!rutas.includes(MIRROR), `el mirror no puede bloquear: ${rutas.join(", ")}`);
  assert.ok(rutas.includes(CANONICA), "la canonica editada SI es un conflicto real, y se sigue reportando");

  // Se acepta la divergencia de la canonica: el mirror tiene que seguir a la
  // canonica LOCAL, no a la del motor.
  sdlc(target, ["upgrade", "--accept-managed", CANONICA]);
  const { buildSkillMirror } = await import("../src/render.js");
  assert.equal(
    fs.readFileSync(mirror, "utf8").replace(/\r\n?/g, "\n"),
    buildSkillMirror("backend-audit", fs.readFileSync(canonica, "utf8").replace(/\r\n?/g, "\n")),
    "tras el upgrade el mirror deriva de la canonica que quedo en disco"
  );

  // Y el manifiesto guarda ese mismo contenido: un sha que no corresponda a
  // ningun fichero es peor que no tenerlo.
  const manifest = JSON.parse(fs.readFileSync(path.join(target, ".sdlc", "install-manifest.json"), "utf8"));
  const entrada = manifest.managedFiles.find((e) => e.path === MIRROR);
  const { createHash } = await import("node:crypto");
  const shaEnDisco = createHash("sha256").update(fs.readFileSync(mirror, "utf8").replace(/\r\n?/g, "\n")).digest("hex");
  assert.equal(entrada?.sha256, shaEnDisco, "el manifiesto describe el fichero que hay, no el que el motor traia");

  // Y `doctor` queda limpio para las tres rutas derivadas.
  const doctor = sdlc(target, ["doctor"]);
  for (const root of [".claude", ".agents", ".windsurf"]) {
    const ruta = `${root}/skills/backend-audit/SKILL.md`;
    assert.deepEqual(hallazgosDe(doctor, ruta), [], `${ruta}: ${JSON.stringify(hallazgosDe(doctor, ruta))}`);
  }
}

console.log("mirror no bloquea upgrade y se regenera: PASS");
