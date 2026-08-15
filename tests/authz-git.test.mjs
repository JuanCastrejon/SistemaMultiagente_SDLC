// ---------------------------------------------------------------------------
// La mitad del modelo de autorizacion que toca git (ADR 0008, G3/D4).
//
// `tests/authz.test.mjs` prueba lo PURO sin montar un repo. Esto prueba lo otro
// contra repos de verdad, y existe porque una ronda adversarial encontro que
// `src/authz-git.js` tenia cobertura CERO: invertir el sentido de exito/fracaso
// de su helper `git()` —del que depende TODA la resolucion de BASE y la lectura
// de contratos— no lo detectaba ningun test del repo.
//
// Aislar la logica pura para poder probarla no prueba que la mitad sucia
// funcione. Es la misma leccion que esta rama aprendio con `compareByUtf8Bytes`,
// aplicada un nivel mas arriba.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  adjudicarAutorizacion,
  leerContratoEnRef,
  ramaDeIntegracionDeclarada,
  resolverBaseDeAutorizacion
} from "../src/authz-git.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-authz-git-"));

function git(repo, args) {
  return execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const CONTRATO_LIMPIO = [
  "version: 1",
  "surfaces:",
  "  - id: app",
  "    path: src",
  "    tier: core",
  "    money_path: false",
  "    regulated_data: false",
  "    security_critical: false",
  "    state_machine_critical: false",
  ""
].join("\n");

const CONTRATO_CRITICO = CONTRATO_LIMPIO.replace("security_critical: false", "security_critical: true");

const FASES_CON_PUERTA = ["version: 2", "phases:", "  - id: F13", "    human_gate: true", ""].join("\n");
const FASES_SIN_PUERTA = ["version: 2", "phases:", "  - id: F13", "    human_gate: false", ""].join("\n");

/** Repo con rama de integracion remota simulada, contratos y config. */
function montarRepo(nombre, { subdir = "", contrato = CONTRATO_LIMPIO, fases = FASES_CON_PUERTA } = {}) {
  const raiz = path.join(tempRoot, nombre);
  const target = subdir ? path.join(raiz, subdir) : raiz;
  fs.mkdirSync(path.join(target, "src"), { recursive: true });
  fs.mkdirSync(path.join(target, ".sdlc"), { recursive: true });
  fs.writeFileSync(path.join(target, "src", "index.js"), "export const x = 1;\n", "utf8");
  fs.writeFileSync(path.join(target, "quality-contract.yaml"), contrato, "utf8");
  fs.writeFileSync(path.join(target, "phase-contract.yaml"), fases, "utf8");
  fs.writeFileSync(
    path.join(target, ".sdlc", "config.json"),
    JSON.stringify({ schemaVersion: 1, gitFlow: { integrationBranch: "develop", stableBranch: "main" } }, null, 2),
    "utf8"
  );
  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "t@example.com"],
    ["config", "user.name", "T"],
    ["add", "-A"],
    ["commit", "--quiet", "-m", "base"],
    ["update-ref", "refs/remotes/origin/develop", "HEAD"]
  ]) {
    git(raiz, args);
  }
  return { raiz, target };
}

// --- 1. la rama sale de la CONFIGURACION, no del PR ----------------------
{
  const { target } = montarRepo("declarada");
  assert.equal(ramaDeIntegracionDeclarada(target).rama, "develop");

  const sinConfig = path.join(tempRoot, "sin-config");
  fs.mkdirSync(sinConfig, { recursive: true });
  assert.equal(ramaDeIntegracionDeclarada(sinConfig).code, "authz-config-missing");

  const sinGitFlow = path.join(tempRoot, "sin-gitflow");
  fs.mkdirSync(path.join(sinGitFlow, ".sdlc"), { recursive: true });
  fs.writeFileSync(path.join(sinGitFlow, ".sdlc", "config.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
  assert.equal(ramaDeIntegracionDeclarada(sinGitFlow).code, "authz-config-missing");

  const roto = path.join(tempRoot, "config-rota");
  fs.mkdirSync(path.join(roto, ".sdlc"), { recursive: true });
  fs.writeFileSync(path.join(roto, ".sdlc", "config.json"), "{ no soy json", "utf8");
  assert.equal(ramaDeIntegracionDeclarada(roto).code, "authz-config-missing");
}

// --- 2. elegir la base es elegir que downgrades son detectables ----------
{
  const { target } = montarRepo("base");
  const ok = resolverBaseDeAutorizacion(target);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(ok.ref, "refs/remotes/origin/develop");

  // Nombrarla igual vale, de las tres formas.
  for (const forma of ["develop", "origin/develop", "refs/remotes/origin/develop"]) {
    assert.equal(resolverBaseDeAutorizacion(target, { baseSolicitada: forma }).ok, true, forma);
  }
  // Cualquier otra cosa, no. `develop-2` es el caso que un prefijo mal
  // comparado dejaria pasar.
  for (const ajena of ["origin/sandbox", "develop-2", "main", "refs/heads/develop"]) {
    assert.equal(resolverBaseDeAutorizacion(target, { baseSolicitada: ajena }).code, "authz-base-mismatch", ajena);
  }
}

// --- 3. un tag homonimo NO secuestra la base ----------------------------
// Las reglas DWIM de gitrevisions prueban `refs/tags/` antes que
// `refs/remotes/`: sin calificar, un tag llamado `origin/develop` sobre el HEAD
// del atacante hace que BASE y HEAD sean el mismo arbol.
{
  const { raiz, target } = montarRepo("tag-homonimo");
  fs.writeFileSync(path.join(target, "src", "index.js"), "export const x = 2;\n", "utf8");
  git(raiz, ["add", "-A"]);
  git(raiz, ["commit", "--quiet", "-m", "cambio del atacante"]);
  git(raiz, ["tag", "origin/develop", "HEAD"]);

  const base = resolverBaseDeAutorizacion(target);
  assert.equal(base.ok, true);
  assert.notEqual(base.base, git(raiz, ["rev-parse", "HEAD"]).trim(), "la base no puede ser el HEAD del atacante");

  // Y sin la ref remota, bloquea en vez de caer al tag.
  git(raiz, ["update-ref", "-d", "refs/remotes/origin/develop"]);
  assert.equal(resolverBaseDeAutorizacion(target).code, "authz-base-unresolvable");
}

// --- 4. `leerContratoEnRef` en instalacion en SUBDIRECTORIO -------------
// `git show <ref>:<ruta>` sin `./` resuelve contra la RAIZ del repo git, no
// contra el cwd. Sin el `./`, en `apps/extension` esta funcion leia el contrato
// de la raiz —o ninguno— y la comparacion BASE->HEAD no corria nunca. Su
// hermana `computeTreeHashAtRef` usa `ls-tree`, que SI es relativa al cwd: las
// dos mitades del mismo mecanismo discrepaban sobre que archivo es el contrato.
{
  const { target } = montarRepo("subdirectorio", { subdir: path.join("apps", "extension") });
  const leido = leerContratoEnRef(target, "refs/remotes/origin/develop", "quality-contract.yaml");
  assert.equal(leido.ok, true, JSON.stringify(leido));
  assert.equal(leido.contract.surfaces[0].id, "app");
}

// --- 5. un contrato ilegible en BASE bloquea ---------------------------
{
  const { raiz, target } = montarRepo("yaml-roto");
  fs.writeFileSync(path.join(target, "quality-contract.yaml"), "surfaces: [\n  - id: sin cerrar\n", "utf8");
  git(raiz, ["add", "-A"]);
  git(raiz, ["commit", "--quiet", "-m", "contrato roto"]);
  git(raiz, ["update-ref", "refs/remotes/origin/develop", "HEAD"]);
  assert.equal(leerContratoEnRef(target, "refs/remotes/origin/develop", "quality-contract.yaml").code, "authz-base-contract-invalid");
}

// --- 6. el downgrade de una superficie ---------------------------------
{
  const { raiz, target } = montarRepo("downgrade", { contrato: CONTRATO_CRITICO });
  fs.writeFileSync(path.join(target, "quality-contract.yaml"), CONTRATO_LIMPIO, "utf8");
  const veredicto = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [{ id: "app", path: "src", tier: "core", money_path: false, regulated_data: false, security_critical: false, state_machine_critical: false }] },
    faseHead: { id: "F13", human_gate: true }
  });
  assert.ok(veredicto.bloqueos.some((b) => b.code === "authz-downgrade"), JSON.stringify(veredicto.bloqueos));
  assert.equal(raiz.length > 0, true);
}

// --- 7. QUITAR LA PUERTA es un downgrade, y su detector no puede vivir
//        detras de la puerta --------------------------------------------
// Este es el caso que la ronda 17 encontro inalcanzable: `adjudicarAutorizacion`
// se invocaba solo dentro de `if (phase.human_gate)`, asi que apagar la puerta
// hacia que el codigo que detecta que alguien la apago no corriera.
{
  const { target } = montarRepo("puerta", { fases: FASES_CON_PUERTA });
  const veredicto = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [{ id: "app", path: "src", tier: "core", money_path: false, regulated_data: false, security_critical: false, state_machine_critical: false }] },
    faseHead: { id: "F13", human_gate: false }
  });
  assert.ok(
    veredicto.bloqueos.some((b) => b.code === "authz-human-gate-removed"),
    JSON.stringify(veredicto.bloqueos)
  );
}

// --- 8. debilitar la POLITICA tambien -----------------------------------
{
  const conPolitica = CONTRATO_LIMPIO.replace(
    "version: 1",
    ["version: 1", "governance:", "  humanGate:", "    policy: attestation"].join("\n")
  );
  const { target } = montarRepo("politica", { contrato: conPolitica });
  const veredicto = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: {
      surfaces: [{ id: "app", path: "src", tier: "core", money_path: false, regulated_data: false, security_critical: false, state_machine_critical: false }],
      governance: { humanGate: { policy: "declarative" } }
    },
    faseHead: { id: "F13", human_gate: true }
  });
  assert.ok(
    veredicto.bloqueos.some((b) => b.code === "authz-policy-downgrade"),
    JSON.stringify(veredicto.bloqueos)
  );
}

// --- 9. la contracara: sin cambios, no hay bloqueo ----------------------
// Sin esto lo de arriba probaria un muro, no un control.
{
  const { target } = montarRepo("sin-cambios");
  const veredicto = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [{ id: "app", path: "src", tier: "core", money_path: false, regulated_data: false, security_critical: false, state_machine_critical: false }] },
    faseHead: { id: "F13", human_gate: true }
  });
  assert.deepEqual(veredicto.bloqueos, [], JSON.stringify(veredicto.bloqueos));
  assert.equal(veredicto.exige, "declarative", "sin riesgos declarados, el coste no aparece");
}

console.log("authz-git: PASS");
