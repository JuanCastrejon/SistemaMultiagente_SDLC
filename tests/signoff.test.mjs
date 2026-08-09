// ---------------------------------------------------------------------------
// P5 (ADR 0007): firma humana verificable por signed-attestation. Decision 1
// del cierre: "nadie lee el codigo" en money_path no se acepta, pero la firma
// no puede pedirse como review de plataforma (insatisfacible con un solo
// maintainer). Este test firma un commit de verdad con una clave GPG efimera
// y lo verifica con `git verify-commit` real, no con un mock.
//
// Nota de entorno (Windows + Git for Windows): el gpg que trae Git es un
// binario MSYS. GNUPGHOME debe pasarse en forma POSIX pura (`/c/...`), no en
// forma de ruta con letra de unidad Windows — esa forma se trata como ruta
// RELATIVA y gpg falla silenciosamente buscando el keybox bajo el cwd. En
// POSIX (Linux/macOS) no hace falta traducir nada.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ATTESTATION_TRAILER,
  buildAttestationMessage,
  computeSubjectSha256,
  createAttestationCommit,
  parseAttestationMessage,
  verifySignoff
} from "../src/signoff.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

function runCli(args, env = process.env) {
  return spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8", env });
}

function toGnupgHome(windowsOrPosixPath) {
  if (os.platform() !== "win32") return windowsOrPosixPath;
  const normalized = windowsOrPosixPath.replace(/\\/g, "/");
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  return match ? `/${match[1].toLowerCase()}/${match[2]}` : normalized;
}

function resolveGpgProgram() {
  try {
    const finder = os.platform() === "win32" ? "where" : "which";
    return execFileSync(finder, ["gpg"], { encoding: "utf8" }).split(/\r?\n/)[0].trim();
  } catch {
    return "gpg";
  }
}

// --- unidad: mensaje de atestacion, sin git de por medio --------------------
const subjectSha256 = computeSubjectSha256({ slice: "s1", phase: "F13", tree_hash: "abc" });
assert.equal(subjectSha256, computeSubjectSha256({ slice: "s1", phase: "F13", tree_hash: "abc" }), "determinista");
assert.notEqual(subjectSha256, computeSubjectSha256({ slice: "s1", phase: "F13", tree_hash: "def" }));

const message = buildAttestationMessage({ slice: "s1", phase: "F13", subjectSha256 });
assert.match(message, new RegExp(`${ATTESTATION_TRAILER}: ${subjectSha256}`));
assert.deepEqual(parseAttestationMessage(message), { subjectSha256 });
assert.equal(parseAttestationMessage("mensaje sin trailer"), null);

console.log("signoff message unit: PASS");

// --- E2E con GPG real: clave efimera, commit firmado, verify-commit real ---
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-signoff-"));
const gnupgHomeReal = path.join(tempRoot, "gnupg");
fs.mkdirSync(gnupgHomeReal, { recursive: true });
const gpgProgram = resolveGpgProgram();
// `signoff.js` spawna git con el `process.env` real del proceso (no acepta un
// env inyectado): para que su `git commit -S` interno encuentre la clave
// efimera, GNUPGHOME tiene que mutarse en el proceso, no vivir en un objeto
// aparte que solo mis propios spawnSync verian.
process.env.GNUPGHOME = toGnupgHome(gnupgHomeReal);
process.env.GPG_TTY = "";

function gpg(args) {
  return execFileSync(gpgProgram, args, { encoding: "utf8" });
}

const SIGNER_UID = "Test Maintainer <maintainer@example.com>";
gpg(["--batch", "--passphrase", "", "--quick-gen-key", SIGNER_UID, "default", "default", "never"]);
const secretKeyListing = gpg(["--list-secret-keys", "--with-colons"]);
const fingerprint = secretKeyListing.split(/\r?\n/).find((line) => line.startsWith("fpr:")).split(":")[9];

const target = path.join(tempRoot, "repo");
fs.mkdirSync(target, { recursive: true });
function git(args) {
  return execFileSync("git", args, { cwd: target, encoding: "utf8" });
}
git(["init", "--quiet"]);
git(["config", "user.email", "maintainer@example.com"]);
git(["config", "user.name", "Test Maintainer"]);
git(["config", "user.signingkey", fingerprint]);
git(["config", "gpg.program", gpgProgram]);
fs.writeFileSync(path.join(target, "README.md"), "# demo\n", "utf8");
git(["add", "."]);
git(["commit", "--quiet", "-m", "base"]);

const maintainers = [{ signer: SIGNER_UID }];
const subject = { slice: "slice-money", phase: "F13", tree_hash: "treehash123" };

// 1. Round-trip real: createAttestationCommit() firma, verifySignoff() valida.
const created = createAttestationCommit({ target, slice: subject.slice, phase: subject.phase, subject });
assert.equal(created.ok, true, JSON.stringify(created));
const verified = verifySignoff({ target, commitSha: created.commitSha, subject, maintainers });
assert.equal(verified.ok, true, JSON.stringify(verified));
assert.equal(verified.signer, SIGNER_UID);

// 2. El codigo cambio despues de la firma: el subject (tree_hash) ya no
// coincide. Una firma vieja no puede aprobar contenido nuevo.
const staleSubject = { ...subject, tree_hash: "otro-arbol-distinto" };
const stale = verifySignoff({ target, commitSha: created.commitSha, subject: staleSubject, maintainers });
assert.equal(stale.ok, false);
assert.equal(stale.code, "signoff-subject-mismatch");

// 3. El firmante no esta en la lista de maintainers.
const wrongMaintainers = verifySignoff({ target, commitSha: created.commitSha, subject, maintainers: [{ signer: "Otra Persona <otra@example.com>" }] });
assert.equal(wrongMaintainers.ok, false);
assert.equal(wrongMaintainers.code, "signoff-signer-not-maintainer");

// 4. Un commit normal, sin firmar, no puede colarse como aprobacion.
git(["commit", "--allow-empty", "-m", "commit normal sin firmar"]);
const unsignedSha = git(["rev-parse", "HEAD"]).trim();
const unsigned = verifySignoff({ target, commitSha: unsignedSha, subject, maintainers });
assert.equal(unsigned.ok, false);
assert.equal(unsigned.code, "signoff-signature-invalid");

// 5. El commit firmado existe pero HEAD ya no lo contiene (se reseteo la
// rama): la firma no forma parte de la historia que se esta evaluando.
// HEAD esta en C3 (el commit sin firmar del caso 4); HEAD~2 vuelve a C1 (la
// base), dejando fuera tanto a C3 como al propio commit firmado C2.
git(["reset", "--hard", "HEAD~2"]);
const detached = verifySignoff({ target, commitSha: created.commitSha, subject, maintainers });
assert.equal(detached.ok, false);
assert.equal(detached.code, "signoff-not-ancestor");

// 6. Sin commit declarado, o con un sha que no existe.
assert.equal(verifySignoff({ target, commitSha: null, subject, maintainers }).code, "signoff-commit-missing");
assert.equal(
  verifySignoff({ target, commitSha: "0000000000000000000000000000000000000000", subject, maintainers }).code,
  "signoff-commit-not-found"
);

console.log("signoff e2e (gpg real): PASS");

// --- CLI: sdlc signoff --create / --verify de punta a punta -----------------
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
      frameworkVersion: "1.0.0",
      project: { name: "Demo", slug: "demo" },
      mode: "greenfield",
      surfaces: [],
      gitFlow: { integrationBranch: "main", stableBranch: "main" },
      openspec: { profile: "minimal" },
      governance: { threatModel: "single-maintainer", maintainers: [{ signer: SIGNER_UID }] }
    },
    null,
    2
  ),
  "utf8"
);

const createOut = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--create", "--json"]).stdout
);
assert.equal(createOut.status, "ok", JSON.stringify(createOut));
assert.ok(createOut.commitSha);

const verifyOut = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--verify", "--commit", createOut.commitSha, "--json"])
    .stdout
);
assert.equal(verifyOut.status, "ok", JSON.stringify(verifyOut));
assert.equal(verifyOut.signer, SIGNER_UID);

// El arbol cambia (src/index.js) sin volver a firmar: --verify con el MISMO
// commit ahora debe bloquear, porque el sujeto recomputado ya no es el que
// el commit aprobo.
fs.writeFileSync(path.join(target, "src", "index.js"), "export const x = 2;\n", "utf8");
const verifyStale = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--verify", "--commit", createOut.commitSha, "--json"])
    .stdout
);
assert.equal(verifyStale.status, "blocked");
assert.equal(verifyStale.code, "signoff-subject-mismatch");

console.log("signoff cli e2e: PASS");
