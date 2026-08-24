// ---------------------------------------------------------------------------
// Que checkpoint entrega `resume`, y cuantos ficheros deja `save`.
//
// Tres defectos medidos USANDO los comandos en un repo consumidor el 2026-08-24,
// no leyendo el codigo. Los tres son la misma forma: el control existia y no
// se disparaba.
//
//   1. `resume` entregaba el checkpoint MAS RECIENTE. El hook `post-merge`
//      corre `sdlc save` en cada merge, asi que el mas reciente es casi siempre
//      un esqueleto con las cinco secciones en `_(pendiente de redactar)_` y
//      con marca de tiempo POSTERIOR a la del que alguien acababa de redactar.
//      `analyzeCheckpointNarrative` ya sabia distinguirlos: la deteccion
//      informaba del problema que el mismo comando seguia cometiendo.
//
//   2. `save --event post-merge` APILABA un esqueleto por merge. 35
//      checkpoints en un dia, 34 de ellos vacios.
//
//   3. `supersedes` apuntaba al ultimo FICHERO. Entre dos esqueletos eso es una
//      cadena de ficheros vacios que se sustituyen entre si, y ademas cerraba
//      la ventana de commits en el ultimo merge en vez de en el ultimo trabajo
//      redactado.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CLI_NARRATIVE_SECTIONS } from "../src/runtime.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

// El entorno se construye, no se hereda: con VAULT_PATH definida el vault del
// test seria el del desarrollador.
const CLEAN_ENV = { ...process.env };
delete CLEAN_ENV.VAULT_PATH;
delete CLEAN_ENV.MEMORY_WORKSPACE;

function newRepo(name) {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-ckpt-${name}-`)), "consumidor");
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

function save(target, event = "manual") {
  return JSON.parse(
    execFileSync("node", [cli, "save", "--target", target, "--event", event, "--json"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: CLEAN_ENV
    })
  );
}

function resume(target, extra = []) {
  const out = execFileSync("node", [cli, "resume", "--target", target, ...extra], {
    cwd: repoRoot,
    encoding: "utf8",
    env: CLEAN_ENV
  });
  return extra.includes("--json") ? JSON.parse(out) : out;
}

function redactar(checkpoint) {
  const cuerpo = fs
    .readFileSync(checkpoint, "utf8")
    .split("_(pendiente de redactar)_")
    .join("Lo que se decidio, por que, y que se descarto.");
  fs.writeFileSync(checkpoint, cuerpo, "utf8");
}

function checkpointsDir(checkpoint) {
  return path.dirname(checkpoint);
}

// El nombre del checkpoint tiene resolucion de MINUTO, asi que dos saves
// seguidos en el mismo minuto caen en el mismo fichero. Para probar la
// SELECCION entre ficheros distintos hay que separarlos a proposito. El
// renombrado no altera el mtime, que es por lo que se ordenan.
function mover(checkpoint, nombre) {
  const destino = path.join(path.dirname(checkpoint), nombre);
  fs.renameSync(checkpoint, destino);
  return destino;
}

function contar(dir) {
  return fs.readdirSync(dir).filter((name) => name.endsWith(".md")).length;
}

// --- 1. el espejo de secciones no puede desincronizarse de la plantilla -----
// `reusablePendingCheckpoint` reconoce un esqueleto intacto comparando contra
// CLI_NARRATIVE_SECTIONS. Si alguien agrega o renombra una seccion en la
// plantilla de `commandSave` y no en esa lista, el reconocimiento falla en
// silencio y `save` vuelve a apilar. Esta asercion es la atadura.
{
  const target = newRepo("espejo");
  const { narrative } = save(target);
  assert.deepEqual(
    [...narrative.pending].sort(),
    [...CLI_NARRATIVE_SECTIONS].sort(),
    "CLI_NARRATIVE_SECTIONS tiene que ser exactamente lo que la plantilla deja pendiente"
  );
}

console.log("checkpoint espejo de secciones: PASS");

// --- 2. resume entrega el REDACTADO, no el esqueleto del hook ---------------
{
  const target = newRepo("seleccion");
  const guardado = save(target, "manual");
  redactar(guardado.checkpoint);
  const bueno = mover(guardado.checkpoint, "200001010000-slice-redactado.md");

  // Un merge cualquiera: el hook deja su esqueleto encima.
  const esqueleto = save(target, "post-merge");
  assert.notEqual(esqueleto.checkpoint, bueno, "el esqueleto del hook es otro fichero");
  assert.equal(esqueleto.narrative.complete, false);

  const json = resume(target, ["--json"]);
  assert.equal(json.latestCheckpoint, esqueleto.checkpoint, "el mas reciente sigue siendo el esqueleto: eso es un hecho, no se oculta");
  assert.equal(json.usableCheckpoint, bueno, "pero el utilizable es el redactado");
  assert.equal(json.skeletonsSinceUsable, 1);

  // Y en markdown —que es lo que lee un agente— el bueno va PRIMERO y el otro
  // sale etiquetado. Nombrar el esqueleto sin decir que no sirve fue el
  // defecto original.
  const md = resume(target, ["--markdown"]);
  assert.match(md, /- checkpoint-utilizable: /, md);
  assert.ok(
    md.indexOf("checkpoint-utilizable") < md.indexOf("checkpoint-mas-reciente"),
    "el que hay que abrir se nombra antes que el que hay que ignorar"
  );
  assert.match(md, /esqueleto sin redactar, NO es el que hay que leer/, md);
}

console.log("resume elige el checkpoint redactado: PASS");

// --- 3. sin ningun checkpoint redactado, resume NO disimula ----------------
{
  const target = newRepo("ninguno");
  save(target, "manual");

  const json = resume(target, ["--json"]);
  assert.equal(json.usableCheckpoint, null);
  assert.equal(json.skeletonsSinceUsable, 0, "sin utilizable, contar esqueletos seria contar el vault entero");

  const md = resume(target, ["--markdown"]);
  assert.match(md, /checkpoint-utilizable: \*\*ninguno\*\*/, md);
}

console.log("resume sin checkpoint redactado: PASS");

// --- 4. el hook no apila: refresca su propio esqueleto pendiente ------------
{
  const target = newRepo("apilado");
  const guardado = save(target, "manual");
  redactar(guardado.checkpoint);
  const dir = checkpointsDir(guardado.checkpoint);
  mover(guardado.checkpoint, "200001010000-slice-redactado.md");

  const primero = save(target, "post-merge");
  assert.equal(primero.refreshedPending, false, "el primer esqueleto se crea");

  // Se renombra para que reutilizar NO pueda ser un accidente de que el nombre
  // por minuto coincida: si el segundo save cae en este mismo fichero, es
  // porque lo reconocio, no porque calculo la misma ruta.
  const renombrado = mover(primero.checkpoint, "200001010001-slice-esqueleto-viejo.md");
  const antes = contar(dir);

  const segundo = save(target, "post-merge");
  assert.equal(segundo.refreshedPending, true, "el segundo merge refresca el esqueleto pendiente");
  assert.equal(segundo.checkpoint, renombrado, "y lo hace sobre el fichero que ya existia");
  assert.equal(contar(dir), antes, "el vault no crece con un esqueleto por merge");

  // Pero si el agente YA redacto ese esqueleto, no se toca: perder media
  // redaccion es peor que un fichero de mas.
  redactar(renombrado);
  const tercero = save(target, "post-merge");
  assert.equal(tercero.refreshedPending, false, "un checkpoint redactado nunca se sobreescribe");
  assert.equal(contar(dir), antes + 1);

  // Y `/save` —evento manual— siempre crea uno nuevo: ahi hay alguien a punto
  // de redactarlo.
  const manual = save(target, "manual");
  assert.equal(manual.refreshedPending, false);
}

console.log("save no apila esqueletos: PASS");

// --- 5. supersedes apunta al redactado y declara los esqueletos saltados ----
{
  const target = newRepo("supersedes");
  const guardado = save(target, "manual");
  redactar(guardado.checkpoint);
  const bueno = mover(guardado.checkpoint, "200001010000-slice-redactado.md");

  const esqueleto = save(target, "post-merge");
  mover(esqueleto.checkpoint, "200001010001-slice-esqueleto.md");

  const nuevo = save(target, "manual");
  const cuerpo = fs.readFileSync(nuevo.checkpoint, "utf8");

  assert.match(
    cuerpo,
    new RegExp(`supersedes: ${path.basename(bueno).replace(/[.]/g, "[.]")}`),
    `supersedes tiene que apuntar al redactado, no al ultimo fichero:\n${cuerpo.slice(0, 400)}`
  );
  assert.match(cuerpo, /superseded_skeletons:/, "los esqueletos saltados se declaran para que nadie los abra");
  assert.match(cuerpo, /- 200001010001-slice-esqueleto[.]md/, cuerpo.slice(0, 400));
}

console.log("save supersedes el ultimo redactado: PASS");

// --- 6. el loop de skills vivas es visible en el propio `Uso:` -------------
// Un comando que existe, funciona y no aparece en la ayuda es un control que
// no se dispara. `skill-lesson`, `skill-eval` y `skill-propose` llevaban
// versiones sin figurar en el listado, y el consumidor construyo su propio
// disparador creyendo que no habia ninguno.
{
  let salida = "";
  try {
    salida = execFileSync("node", [cli, "help"], { cwd: repoRoot, encoding: "utf8", env: CLEAN_ENV });
  } catch (error) {
    salida = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  }
  for (const comando of ["skill-lesson", "skill-eval", "skill-propose", "tools-install"]) {
    assert.ok(salida.includes(comando), `el Uso: tiene que listar ${comando}`);
  }
}

console.log("CLI lista los comandos de skills vivas: PASS");
