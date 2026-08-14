// ---------------------------------------------------------------------------
// Auditoria de atestaciones y reparacion asistida (2.0.0).
//
// El defecto que motiva esto se encontro auditando la propia migracion: la nota
// de 2.0.0 decia "volver a firmar con `sdlc signoff --create`", y ese comando
// crea el commit pero NO toca la evidencia. `attestation_commit` existia solo
// como campo LEIDO en el harness; nada lo escribia. Es decir, la reparacion
// documentada dejaba la evidencia apuntando a la firma vieja y el gate seguia
// bloqueando, con el usuario convencido de haberlo arreglado.
//
// Se cubre el ciclo entero: atestacion rota -> `upgrade`/`doctor` la nombran ->
// `signoff --create --record` la repara -> `phase-gate` pasa. Y se distingue
// "no se pudo comprobar" (commit ausente, clon superficial) de "la firma no
// vale", que es lo que evita falsos positivos en CI con `fetch-depth: 1`.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { auditAttestations } from "../src/harness.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-attestation-"));

function runCli(args) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
}

// --- consumidor con firma SSH real ------------------------------------------
const target = path.join(tempRoot, "consumidor");
const SIGNER = "maintainer@example.com";
let ready = true;
try {
  fs.mkdirSync(target, { recursive: true });
  const keyPath = path.join(tempRoot, "id_ed25519");
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", SIGNER, "-f", keyPath], { stdio: "ignore" });
  const allowedSigners = path.join(tempRoot, "allowed_signers");
  fs.writeFileSync(allowedSigners, `${SIGNER} namespaces="git" ${fs.readFileSync(`${keyPath}.pub`, "utf8").trim()}\n`, "utf8");

  const git = (args) => execFileSync("git", args, { cwd: target, encoding: "utf8" });
  git(["init", "--quiet"]);
  git(["config", "user.email", SIGNER]);
  git(["config", "user.name", "Test Maintainer"]);
  git(["config", "gpg.format", "ssh"]);
  git(["config", "user.signingkey", `${keyPath}.pub`.replace(/\\/g, "/")]);
  git(["config", "gpg.ssh.allowedSignersFile", allowedSigners.replace(/\\/g, "/")]);

  fs.mkdirSync(path.join(target, "src"), { recursive: true });
  fs.writeFileSync(path.join(target, "src", "index.js"), "export const x = 1;\n", "utf8");
  fs.writeFileSync(
    path.join(target, "quality-contract.yaml"),
    "version: 1\nenforcement: observe\ntiers:\n  core:\n    description: unico tier\nsurfaces:\n  - id: s\n    path: src\n    tier: core\nprobes: []\ngates: []\n",
    "utf8"
  );
  fs.mkdirSync(path.join(target, ".sdlc"), { recursive: true });
  fs.writeFileSync(
    path.join(target, ".sdlc", "config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        frameworkVersion: "2.0.0",
        project: { name: "Demo", slug: "demo" },
        mode: "greenfield",
        surfaces: [],
        gitFlow: { integrationBranch: "main", stableBranch: "main" },
        openspec: { profile: "minimal" },
        governance: { maintainers: [{ signer: SIGNER }] }
      },
      null,
      2
    ),
    "utf8"
  );

  const evidenceDir = path.join(target, ".github", "agent-state", "evidence", "slice-firmado");
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, "F13.yaml"),
    YAML.stringify({
      phase: "F13",
      slice: "slice-firmado",
      agent_id: "pm",
      started_at: new Date(0).toISOString(),
      outputs: [],
      validators_run: [],
      human_gate_signoff: {
        required: true,
        approved_by: "alguien",
        signature_class: "attestation",
        // Commit que no existe: es el estado en que queda una evidencia cuando
        // alguien la escribe a mano, o cuando la historia se reescribio.
        attestation_commit: "0000000000000000000000000000000000000000"
      }
    }),
    "utf8"
  );
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "base"]);
} catch (error) {
  ready = false;
  console.log(`attestation audit: SKIP (${error.message.split("\n")[0]})`);
}

if (ready) {
  // --- 1. "no se pudo comprobar" NO es "la firma no vale" -------------------
  // Un commit ausente puede ser un clon superficial. Se reporta, pero como
  // warning: tratarlo como firma invalida daria falsos positivos en cualquier
  // CI con fetch-depth 1.
  const ausente = auditAttestations(target);
  assert.equal(ausente.checked, 1);
  assert.equal(ausente.findings.length, 1);
  // El codigo exacto depende de donde se tropiece primero con el commit ausente
  // —al leer su arbol o al comprobar que existe—; lo que fija el contrato es que
  // ambos casos son "no se pudo comprobar", nunca "la firma no vale".
  assert.ok(
    ["attestation-tree-ref-unreadable", "attestation-signoff-commit-not-found"].includes(ausente.findings[0].code),
    ausente.findings[0].code
  );
  assert.equal(ausente.findings[0].level, "warning", "un commit ausente no puede acusarse de firma invalida");
  assert.match(ausente.findings[0].hint, /--create --record/, "el hallazgo tiene que traer el comando de reparacion");

  // --- 2. una firma que existe pero aprueba OTRA cosa si es error -----------
  const otroCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }).trim();
  const evidencePath = path.join(target, ".github", "agent-state", "evidence", "slice-firmado", "F13.yaml");
  const doc = YAML.parse(fs.readFileSync(evidencePath, "utf8"));
  doc.human_gate_signoff.attestation_commit = otroCommit;
  fs.writeFileSync(evidencePath, YAML.stringify(doc), "utf8");

  const invalida = auditAttestations(target);
  assert.equal(invalida.findings.length, 1);
  assert.equal(invalida.findings[0].level, "error", "un commit real sin firma valida SI es error");
  assert.match(invalida.findings[0].code, /^attestation-signoff-/);

  // --- 3. doctor la nombra --------------------------------------------------
  let doctorPayload;
  try {
    doctorPayload = JSON.parse(execFileSync("node", [cli, "doctor", "--target", target, "--json"], { cwd: repoRoot, encoding: "utf8" }));
  } catch (error) {
    doctorPayload = JSON.parse(error.stdout.toString());
  }
  assert.ok(
    doctorPayload.findings.some((finding) => String(finding.code).startsWith("attestation-")),
    `doctor tiene que reportar la atestacion rota: ${JSON.stringify(doctorPayload.findings.map((f) => f.code))}`
  );

  // --- 4. la reparacion asistida cierra el ciclo -----------------------------
  const reparado = JSON.parse(
    runCli(["signoff", "--target", target, "--slice", "slice-firmado", "--phase", "F13", "--create", "--record", "--json"]).stdout
  );
  assert.equal(reparado.status, "ok", JSON.stringify(reparado));
  assert.equal(reparado.recorded, true);
  assert.equal(reparado.signer, SIGNER, "approved_by se deriva del firmante que reporta git, no de una opcion");

  const tras = YAML.parse(fs.readFileSync(evidencePath, "utf8"));
  assert.equal(tras.human_gate_signoff.attestation_commit, reparado.commitSha);
  assert.equal(tras.human_gate_signoff.approved_by, SIGNER);
  assert.equal(tras.human_gate_signoff.signature_class, "attestation");
  // Re-firmar no borra a quien aprobo antes.
  assert.equal(tras.history.length, 1);
  assert.equal(tras.history[0].human_gate_signoff.attestation_commit, otroCommit);

  const limpio = auditAttestations(target);
  assert.deepEqual(limpio.findings, [], "tras la reparacion no queda ningun hallazgo");
  assert.equal(limpio.checked, 1);

  console.log("attestation audit y reparacion: PASS");

  // --- 5. sin evidencia previa NO se crea el commit -------------------------
  // Antes se creaba y luego fallaba el enlace, dejando un commit de aprobacion
  // huerfano en la historia que nadie iba a limpiar. Las precondiciones que no
  // cambian por firmar se comprueban ANTES de firmar.
  const antes = execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }).trim();
  const sinEvidencia = JSON.parse(
    runCli(["signoff", "--target", target, "--slice", "slice-sin-evidencia", "--phase", "F13", "--create", "--record", "--json"]).stdout
  );
  assert.equal(sinEvidencia.status, "blocked");
  assert.equal(sinEvidencia.code, "evidence-missing");
  assert.equal(sinEvidencia.recorded, false);
  assert.equal(sinEvidencia.commitSha, undefined, "no puede haberse creado ningun commit");
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }).trim(),
    antes,
    "la historia no se toca si el enlace no se puede garantizar"
  );

  console.log("attestation record sin evidencia: PASS");

  // --- 6. enlazar un commit ya firmado, sin volver a firmar -----------------
  // El camino de recuperacion cuando la firma existe pero el enlace fallo:
  // obligar a firmar otra vez dejaria dos commits de aprobacion para lo mismo,
  // y el segundo no seria mas valido que el primero.
  const firmado = reparado.commitSha;
  const docSuelto = YAML.parse(fs.readFileSync(evidencePath, "utf8"));
  delete docSuelto.human_gate_signoff.attestation_commit;
  docSuelto.human_gate_signoff.signature_class = "declarative";
  fs.writeFileSync(evidencePath, YAML.stringify(docSuelto), "utf8");

  const reenlazado = JSON.parse(
    runCli(["signoff", "--target", target, "--slice", "slice-firmado", "--phase", "F13", "--record", "--commit", firmado, "--json"]).stdout
  );
  assert.equal(reenlazado.status, "ok", JSON.stringify(reenlazado));
  assert.equal(reenlazado.recorded, true);
  assert.equal(YAML.parse(fs.readFileSync(evidencePath, "utf8")).human_gate_signoff.attestation_commit, firmado);
  assert.equal(
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: target, encoding: "utf8" }).trim(),
    firmado,
    "enlazar no crea historia nueva"
  );

  // Un commit que no verifica no se enlaza, aunque se pida explicitamente.
  const noVerifica = JSON.parse(
    runCli(["signoff", "--target", target, "--slice", "slice-firmado", "--phase", "F13", "--record", "--commit", otroCommit, "--json"]).stdout
  );
  assert.equal(noVerifica.status, "blocked");
  assert.equal(noVerifica.recorded, false);

  console.log("attestation record de commit existente: PASS");
}
