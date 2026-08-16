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
  auditarAutorizacion,
  leerContratoEnRef,
  ramaDeIntegracionDeclarada,
  resolverBaseDeAutorizacion
} from "../src/authz-git.js";
import { auditAttestations, evaluatePhaseReadiness } from "../src/harness.js";

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
const FASES_BASE_DOS = [
  "version: 2",
  "phases:",
  "  - id: F13",
  "    human_gate: true",
  "  - id: F14",
  "    human_gate: false",
  ""
].join("\n");
const SUPERFICIE_LIMPIA = {
  id: "app",
  path: "src",
  tier: "core",
  money_path: false,
  regulated_data: false,
  security_critical: false,
  state_machine_critical: false
};

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

// --- 10. el contrato de FASES ilegible en BASE bloquea, no calla ---------
// La ronda 18 lo reproducjo: `fasesBase.presente && fasesBase.ok` tragaba el
// error de lectura y quitar la puerta devolvia ok:true. Asimetrico con el
// quality-contract de BASE, que si bloquea (caso 5).
{
  const { target } = montarRepo("fases-rotas-base", { fases: "phases: [\n  - id: sin cerrar\n" });
  const veredicto = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F13", human_gate: false }
  });
  assert.ok(
    veredicto.bloqueos.some((b) => b.code === "authz-base-contract-invalid"),
    JSON.stringify(veredicto.bloqueos)
  );
}

// --- 11. debilitar el override de OTRA fase se ve en cualquier gate ------
// M3 de la ronda 18 sobrevivia: `compararPolitica(..., [phaseId])` solo miraba
// la fase actual, y nadie gatea todas las fases en cada corrida.
{
  const conOverride = CONTRATO_LIMPIO.replace(
    "version: 1",
    [
      "version: 1",
      "governance:",
      "  humanGate:",
      "    policy: declarative",
      "    overrides:",
      "      F5: attestation"
    ].join("\n")
  );
  const { target } = montarRepo("override-otra-fase", { contrato: conOverride });
  const veredicto = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: {
      surfaces: [SUPERFICIE_LIMPIA],
      governance: { humanGate: { policy: "declarative", overrides: { F5: "declarative" } } }
    },
    faseHead: { id: "F13", human_gate: true }
  });
  assert.ok(
    veredicto.bloqueos.some((b) => b.code === "authz-policy-downgrade" && b.detail.includes("F5")),
    JSON.stringify(veredicto.bloqueos)
  );
}

// --- 12. borrar la fase con puerta del contrato HEAD es quitar la puerta -
// S2 de la ronda 18: el detector anterior solo miraba la fase que se gateaba,
// asi que la fase borrada —a la que nadie vuelve a gatear— era invisible.
{
  const { target } = montarRepo("fase-borrada", { fases: FASES_BASE_DOS });
  const borrada = adjudicarAutorizacion({
    target,
    phaseId: "F14",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F14", human_gate: false },
    fasesHead: { phases: [{ id: "F14", human_gate: false }] }
  });
  assert.ok(
    borrada.bloqueos.some((b) => b.code === "authz-human-gate-removed" && b.detail.includes("F13")),
    JSON.stringify(borrada.bloqueos)
  );

  // Contracara: la fase con puerta sigue en HEAD, misma fase gateada, cero
  // bloqueos nuevos por enumeracion.
  const intacta = adjudicarAutorizacion({
    target,
    phaseId: "F14",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F14", human_gate: false },
    fasesHead: { phases: [{ id: "F13", human_gate: true }, { id: "F14", human_gate: false }] }
  });
  assert.deepEqual(intacta.bloqueos, [], JSON.stringify(intacta.bloqueos));
}

// --- 13. la severidad de base-unresolvable depende de la puerta ---------
// M6 de la ronda 18 sobrevivia: ningun test conducia hasta el early-return
// y afirmaba bloqueo CON puerta contra aviso SIN puerta.
{
  const { raiz, target } = montarRepo("base-fuera");
  git(raiz, ["update-ref", "-d", "refs/remotes/origin/develop"]);
  const conPuerta = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F13", human_gate: true }
  });
  assert.ok(
    conPuerta.bloqueos.some((b) => b.code === "authz-base-unresolvable"),
    JSON.stringify(conPuerta.bloqueos)
  );
  const sinPuerta = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F13", human_gate: false }
  });
  assert.ok(
    sinPuerta.avisos.some((a) => a.code === "authz-base-unresolvable"),
    JSON.stringify(sinPuerta.avisos)
  );
  assert.deepEqual(sinPuerta.bloqueos, [], JSON.stringify(sinPuerta.bloqueos));
}

// --- 14. el cableado: la adjudicacion corre SIN archivo de evidencia ----
// H1 y M1 de la ronda 18. La llamada vivia dentro de `if (evidence.exists)`:
// en una fase sin `evidence_required`, borrar la evidencia dejaba el gate en
// verde sin UNA comprobacion de autorizacion. Y la regresion central (M1,
// adjudicacion solo con puerta) sobrevivia la suite completa porque ningun
// test ejercitaba este cable. Este caso muere si la adjudicacion vuelve a
// colgar de cualquier condicion: sin evidencia que exista y sin puerta.
{
  const { target } = montarRepo("cableado-sin-evidencia", { fases: FASES_CON_PUERTA });
  fs.writeFileSync(path.join(target, "phase-contract.yaml"), FASES_SIN_PUERTA, "utf8");
  const resultado = evaluatePhaseReadiness(target, "F13", "slice-cableado");
  assert.equal(resultado.status, "blocked", JSON.stringify(resultado.blockers));
  assert.ok(resultado.blockers.includes("authz-human-gate-removed"), JSON.stringify(resultado.blockers));
  assert.ok(resultado.evidence.authorization, "la autorizacion se reporta aunque la evidencia no exista");
  assert.equal(resultado.evidence.exists, false);
}

// --- 15. `exige` no depende de que exista la ref remota (H7 de la ronda 18) -
// F2/F3 no tienen arbol que atestar: el early-return devolvia `enHead.exige`
// ("attestation" con puerta) cuando la base no resolvia, y "ninguna" cuando
// si. Misma entrada, salida distinta segun el entorno.
{
  const { raiz, target } = montarRepo("exige-f2");
  git(raiz, ["update-ref", "-d", "refs/remotes/origin/develop"]);
  const sinRef = adjudicarAutorizacion({
    target,
    phaseId: "F2",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F2", human_gate: true }
  });
  assert.equal(sinRef.exige, "ninguna", JSON.stringify(sinRef));

  const { target: targetConRef } = montarRepo("exige-f2-b");
  const conRef = adjudicarAutorizacion({
    target: targetConRef,
    phaseId: "F2",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F2", human_gate: true }
  });
  assert.equal(conRef.exige, "ninguna", JSON.stringify(conRef));
}

// --- 16. `authz-base-unreachable`: la ref existe, el DAG no conecta ---------
// Sin ancestro comun entre HEAD y la remota no hay obligacion contra la que
// comparar. Se monta con `commit-tree` sin padre: segunda raiz, mismo arbol.
{
  const { raiz, target } = montarRepo("dag-roto");
  const aislado = git(raiz, ["commit-tree", "HEAD^{tree}", "-m", "raiz aislada"]).trim();
  git(raiz, ["update-ref", "refs/remotes/origin/develop", aislado]);
  const base = resolverBaseDeAutorizacion(target);
  assert.equal(base.code, "authz-base-unreachable", JSON.stringify(base));

  // Y la severidad es la misma de base-unresolvable: con puerta bloquea, sin
  // puerta avisa.
  const conPuerta = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F13", human_gate: true }
  });
  assert.ok(conPuerta.bloqueos.some((b) => b.code === "authz-base-unreachable"), JSON.stringify(conPuerta.bloqueos));
  const sinPuerta = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F13", human_gate: false }
  });
  assert.ok(sinPuerta.avisos.some((a) => a.code === "authz-base-unreachable"), JSON.stringify(sinPuerta.avisos));
}

// --- 17. la auditoria no calla cuando la BASE no se puede leer (H8) --------
// `doctor` y `upgrade` reportan: una auditoria que calla cuando no puede mirar
// se lee como una auditoria que miro y no encontro nada.
{
  const { target } = montarRepo("auditoria-base-rota", { contrato: "surfaces: [\n" });
  fs.writeFileSync(path.join(target, "quality-contract.yaml"), CONTRATO_LIMPIO, "utf8");
  const findings = auditarAutorizacion(target, { surfaces: [SUPERFICIE_LIMPIA] });
  assert.ok(
    findings.some((f) => f.code === "authz-base-contract-invalid" && f.level === "error"),
    JSON.stringify(findings)
  );

  // Contracara: BASE legible y sin cambios -> la auditoria no inventa ruido.
  const { target: targetLimpio } = montarRepo("auditoria-limpia");
  const limpios = auditarAutorizacion(targetLimpio, { surfaces: [SUPERFICIE_LIMPIA] });
  assert.deepEqual(limpios, [], JSON.stringify(limpios));
}

// --- 18. una fase CON puerta y SIN evidencia no pasa el gate (ronda 19) ----
// La comprobacion del signoff vivia dentro de `if (evidence.exists)`: en una
// fase sin `evidence_required`, no escribir (o borrar) el archivo de evidencia
// abria la puerta sin firma y sin bloqueos. Quinta instancia del patron del
// detector tras la condicion que detecta — la ronda 18 izo la adjudicacion y
// dejo el signoff en el mismo sitio.
{
  const { target } = montarRepo("puerta-sin-evidencia", { fases: FASES_CON_PUERTA });
  const bloqueado = evaluatePhaseReadiness(target, "F13", "slice-s18");
  assert.equal(bloqueado.status, "blocked", JSON.stringify(bloqueado.blockers));
  assert.ok(bloqueado.blockers.includes("human-gate-signoff-missing"), JSON.stringify(bloqueado.blockers));

  // Y con el archivo CORRUPTO pasa lo mismo: sin evidencia legible no hay
  // firma que comprobar, sea porque no existe o porque no se puede leer.
  const dirCorrupto = path.join(target, ".github", "agent-state", "evidence", "slice-s18");
  fs.mkdirSync(dirCorrupto, { recursive: true });
  fs.writeFileSync(path.join(dirCorrupto, "F13.yaml"), "{ no soy yaml", "utf8");
  const corrompido = evaluatePhaseReadiness(target, "F13", "slice-s18");
  assert.equal(corrompido.status, "blocked", JSON.stringify(corrompido.blockers));
  assert.ok(corrompido.blockers.includes("human-gate-signoff-missing"), JSON.stringify(corrompido.blockers));

  // Contracara: sin puerta y sin cambios, el gate sigue saliendo limpio — el
  // bloqueo nuevo es de la puerta, no del archivo.
  const { target: sinPuerta } = montarRepo("sin-puerta-limpia", { fases: FASES_SIN_PUERTA });
  const listo = evaluatePhaseReadiness(sinPuerta, "F13", "slice-s18b");
  assert.equal(listo.status, "ok", JSON.stringify(listo.blockers));
}

// --- 19. la auditoria ve la evidencia ilegible (ronda 19) -------------------
// Un YAML roto se saltaba en silencio: ni contaba ni se reportaba. Corromper
// la evidencia era la forma barata de esconder una atestacion podrida.
{
  const { target } = montarRepo("auditoria-evidencia-rota", { fases: FASES_CON_PUERTA });
  const dir = path.join(target, ".github", "agent-state", "evidence", "slice-s19");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "F13.yaml"), "{ no soy yaml", "utf8");
  const auditoria = await auditAttestations(target);
  assert.ok(
    auditoria.findings.some((f) => String(f.code).startsWith("evidence-unreadable:") && f.level === "error"),
    JSON.stringify(auditoria.findings)
  );
}

// --- 20. quality-contract invalido en BASE tambien bloquea la adjudicacion -
// El caso 5 prueba `leerContratoEnRef` solo; el bloqueo que lo convierte
// (paso 2 de `adjudicarAutorizacion`) no lo ejercitaba nadie — descubierto
// mutandolo en la ronda 19.
{
  const { target } = montarRepo("calidad-rota-base", { contrato: "surfaces: [\n" });
  const veredicto = adjudicarAutorizacion({
    target,
    phaseId: "F13",
    contratoHead: { surfaces: [SUPERFICIE_LIMPIA] },
    faseHead: { id: "F13", human_gate: true }
  });
  assert.ok(
    veredicto.bloqueos.some((b) => b.code === "authz-base-contract-invalid"),
    JSON.stringify(veredicto.bloqueos)
  );
}

console.log("authz-git: PASS");
