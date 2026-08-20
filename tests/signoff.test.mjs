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
  judgeSignoff,
  parseAttestationMessage,
  subjectV1,
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

// 1b. La HUELLA de la clave manda (ronda 19, M2): declararla EXCLUYE la union
// por principal, y una huella que no emparea rechaza aunque el email sea el
// correcto. El mutante que comparaba solo el PREFIJO de la huella pasaba la
// suite entera — por eso la huella erronea difiere solo en el ULTIMO caracter.
const huellaCasiBuena = `${fingerprint.slice(0, -1)}${fingerprint.endsWith("0") ? "1" : "0"}`;
const porHuella = verifySignoff({
  target,
  commitSha: created.commitSha,
  subject,
  maintainers: [{ signer: SIGNER_UID, fingerprint }]
});
assert.equal(porHuella.ok, true, JSON.stringify(porHuella));
assert.equal(porHuella.identityBinding, "fingerprint");
const huellaErrada = verifySignoff({
  target,
  commitSha: created.commitSha,
  subject,
  maintainers: [{ signer: SIGNER_UID, fingerprint: huellaCasiBuena }]
});
assert.equal(huellaErrada.ok, false, JSON.stringify(huellaErrada));
assert.equal(huellaErrada.code, "signoff-signer-not-maintainer", "huella declarada que no emparea excluye la union por principal");

// 1c. El canon del sujeto esta ANCLADO (ronda 19, M5): todos los tests
// computaban el hash EN VIVO — crear y verificar compartian la funcion — asi
// que cambiar el formato del canon era invisible para la suite. Estos
// literales SON el contrato: si el canon cambia, toda atestacion firmada deja
// de valer, y eso tiene que ser un fallo, no un dato.
assert.equal(
  computeSubjectSha256({ slice: "s1", phase: "F13", tree_hash: "abc", contract_sha256: "c1", phase_contract_sha256: "p1" }),
  "d2534302c50b03e8062f914f81130886f50708db5df0c8721ea1230147eacbf6"
);
assert.equal(
  computeSubjectSha256(subjectV1({ slice: "s1", phase: "F13", tree_hash: "abc", contract_sha256: "c1", phase_contract_sha256: "p1" })),
  "f339f759e38897f375d3a5737e0ade109e343ee477f50ab4d53d541fe5425507"
);

// 1d. Un sujeto v1 firmado se rechaza con su codigo propio (ronda 19, M8): la
// distincion dice QUE hacer — re-firmar, no investigar — y nadie la probaba.
// El mensaje se firma con el hash v1 de un sujeto v2: solo casa si la
// atestacion se emitio con el formato anterior.
const sujetoV2 = { slice: "slice-money", phase: "F13", tree_hash: "treehash123", contract_sha256: "c1", phase_contract_sha256: "p1" };
const mensajeV1 = buildAttestationMessage({
  slice: sujetoV2.slice,
  phase: sujetoV2.phase,
  subjectSha256: computeSubjectSha256(subjectV1(sujetoV2))
});
const factsV1 = {
  ancestor: true,
  exists: true,
  verifyOk: true,
  log: ["G", SIGNER_UID, fingerprint, fingerprint, mensajeV1].join("\0")
};
const v1 = judgeSignoff({ facts: factsV1, commitSha: "abc123def456", subject: sujetoV2, maintainers, headRef: "HEAD" });
assert.equal(v1.ok, false, JSON.stringify(v1));
assert.equal(v1.code, "signoff-subject-v1", JSON.stringify(v1));

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

// Firmar con cambios sin commitear firmaria el arbol de HEAD y no lo que hay
// en disco: se bloquea antes de crear nada.
const dirtyCreate = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--create", "--json"]).stdout
);
assert.equal(dirtyCreate.status, "blocked", JSON.stringify(dirtyCreate));
assert.equal(dirtyCreate.code, "signoff-worktree-dirty");

git(["add", "."]);
git(["commit", "--quiet", "-m", "contenido a aprobar"]);
const approvedSha = git(["rev-parse", "HEAD"]).trim();

const createOut = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--create", "--json"]).stdout
);
assert.equal(createOut.status, "ok", JSON.stringify(createOut));
assert.ok(createOut.commitSha);
assert.ok(createOut.files > 0, "el sujeto tiene que anclar archivos reales");
// `created` es lo unico que deja al renderizador humano AFIRMAR que el commit
// existe. Sin el, la salida sin `--json` tendria que adivinarlo por la
// presencia de otros campos, y adivinar aqui es como se llega a decirle a
// alguien que no firmo cuando si firmo.
assert.equal(createOut.created, true, "el payload tiene que declarar que el commit se creo");

// La MISMA firma, sin `--json`: es la invocacion que hace un humano en una
// terminal, y la que salia completamente muda. Tiene que decir que creo el
// commit, con que sha, y que aun falta enlazarlo.
const createHumano = runCli([
  "signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--create"
]);
assert.equal(createHumano.status, 0, createHumano.stderr);
assert.notEqual(`${createHumano.stdout}`.trim(), "", "firmar en una terminal no puede ser mudo");
assert.match(createHumano.stdout, /CREADO/, "tiene que decir que el commit se creo");
assert.match(createHumano.stdout, /[0-9a-f]{40}/, "tiene que dar el sha completo del commit");
assert.match(createHumano.stdout, /--record/, "y avisar de que la firma no quedo enlazada");
assert.doesNotMatch(
  createHumano.stdout,
  /SDLC-Signoff-Subject-SHA256/,
  "el cuerpo del commit de atestacion no es la salida humana"
);
// Esa segunda firma deja el arbol donde estaba para el resto del test: el
// commit de atestacion es vacio y no toca ninguna superficie.

const verifyOut = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--verify", "--commit", createOut.commitSha, "--json"])
    .stdout
);
assert.equal(verifyOut.status, "ok", JSON.stringify(verifyOut));
assert.equal(verifyOut.signer, SIGNER_UID);
assert.equal(verifyOut.fresh, true);

// REGRESION (manga-translator-mvp, 2026-08): el arbol cambia y se commitea
// despues de firmar. La firma NO caduca — sigue atestando el arbol que aprobo,
// que es lo que la hace servir como registro de que la fase se aprobo — pero se
// reporta `fresh: false`, y `--require-fresh` la bloquea para quien exija que
// lo aprobado sea lo actual.
fs.writeFileSync(path.join(target, "src", "index.js"), "export const x = 2;\n", "utf8");
git(["add", "."]);
git(["commit", "--quiet", "-m", "cambio posterior a la firma"]);

const verifyAfterChange = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--verify", "--commit", createOut.commitSha, "--json"])
    .stdout
);
assert.equal(verifyAfterChange.status, "ok", JSON.stringify(verifyAfterChange));
assert.equal(verifyAfterChange.fresh, false);

const verifyFresh = JSON.parse(
  runCli([
    "signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13",
    "--verify", "--commit", createOut.commitSha, "--require-fresh", "--json"
  ]).stdout
);
assert.equal(verifyFresh.status, "blocked");
assert.equal(verifyFresh.code, "signoff-stale");

// El sujeto se ancla al arbol del commit firmado, no al de HEAD: dos commits
// despues sigue siendo el mismo hash.
assert.equal(verifyAfterChange.subject.tree_hash, verifyOut.subject.tree_hash);

// Una firma de otra fase no aprueba esta: slice y phase entran en el sujeto.
const verifyOtherPhase = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F15", "--verify", "--commit", createOut.commitSha, "--json"])
    .stdout
);
assert.equal(verifyOtherPhase.status, "blocked");
assert.equal(verifyOtherPhase.code, "signoff-subject-mismatch");

console.log("signoff cli e2e: PASS");

// --- El maintainer declarado en la otra forma de %GS -------------------------
// GPG reporta el UID completo; con `gpg.format=ssh` git reporta solo el
// principal de allowed_signers. Declarar el email pelado tiene que valer contra
// una firma GPG cuyo %GS es "Nombre <email>", y al reves. Es exactamente lo que
// costo un commit de bootstrap en manga-translator-mvp.
// El commit de la seccion anterior (`created`) quedo fuera de la historia por
// el reset del caso 5; el vigente es el que creo el CLI.
const cliSubject = verifyOut.subject;
const emailOnly = verifySignoff({
  target,
  commitSha: createOut.commitSha,
  subject: cliSubject,
  maintainers: [{ signer: "maintainer@example.com" }]
});
assert.equal(emailOnly.ok, true, JSON.stringify(emailOnly));

const otherEmail = verifySignoff({
  target,
  commitSha: createOut.commitSha,
  subject: cliSubject,
  maintainers: [{ signer: "otro@example.com" }]
});
assert.equal(otherEmail.ok, false);
assert.equal(otherEmail.code, "signoff-signer-not-maintainer");
assert.match(otherEmail.detail, /maintainer@example\.com/, "el error tiene que mostrar el %GS observado");

console.log("signoff signer matching (gpg uid vs principal ssh): PASS");

// --- Superficie fantasma: no se firma ni se verifica el vacio ----------------
// Con `apps/api`/`apps/web` (los placeholders del instalador) el arbol resuelve
// a cero archivos y el tree_hash es el SHA-256 de la cadena vacia. Una firma
// asi es criptograficamente valida y semanticamente hueca.
fs.writeFileSync(
  path.join(target, "quality-contract.yaml"),
  "version: 1\nenforcement: observe\ntiers:\n  core:\n    description: unico tier\nsurfaces:\n  - id: fantasma\n    path: apps/api\n    tier: core\nprobes: []\ngates: []\n",
  "utf8"
);
git(["add", "."]);
git(["commit", "--quiet", "-m", "contrato con superficie fantasma"]);

const createEmpty = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--create", "--json"]).stdout
);
assert.equal(createEmpty.status, "blocked", JSON.stringify(createEmpty));
assert.equal(createEmpty.code, "signoff-empty-subject");

const verifyEmpty = JSON.parse(
  runCli(["signoff", "--target", target, "--slice", "slice-cli", "--phase", "F13", "--verify", "--commit", createOut.commitSha, "--json"])
    .stdout
);
assert.equal(verifyEmpty.status, "blocked", JSON.stringify(verifyEmpty));
assert.equal(verifyEmpty.code, "signoff-empty-subject");

console.log("signoff empty-subject guard: PASS");

// --- E2E con firma SSH real -------------------------------------------------
// El unico camino que estaba sin cubrir, y el que usan de hecho los
// consumidores: `gpg.format=ssh`. Aqui es donde `-S<keyid>` pegado fallaba y
// donde %GS devuelve el principal de allowed_signers en vez de un UID.
const sshTarget = path.join(tempRoot, "repo-ssh");
const SSH_PRINCIPAL = "ssh-signer@example.com";
let sshReady = true;
try {
  fs.mkdirSync(sshTarget, { recursive: true });
  const keyPath = path.join(tempRoot, "id_ed25519");
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", SSH_PRINCIPAL, "-f", keyPath], { stdio: "ignore" });
  const publicKey = fs.readFileSync(`${keyPath}.pub`, "utf8").trim();
  const allowedSigners = path.join(tempRoot, "allowed_signers");
  fs.writeFileSync(allowedSigners, `${SSH_PRINCIPAL} namespaces="git" ${publicKey}\n`, "utf8");

  const gitSsh = (args) => execFileSync("git", args, { cwd: sshTarget, encoding: "utf8" });
  gitSsh(["init", "--quiet"]);
  gitSsh(["config", "user.email", SSH_PRINCIPAL]);
  gitSsh(["config", "user.name", "SSH Signer"]);
  gitSsh(["config", "gpg.format", "ssh"]);
  gitSsh(["config", "user.signingkey", `${keyPath}.pub`.replace(/\\/g, "/")]);
  gitSsh(["config", "gpg.ssh.allowedSignersFile", allowedSigners.replace(/\\/g, "/")]);

  fs.mkdirSync(path.join(sshTarget, "src"), { recursive: true });
  fs.writeFileSync(path.join(sshTarget, "src", "index.js"), "export const y = 1;\n", "utf8");
  fs.writeFileSync(
    path.join(sshTarget, "quality-contract.yaml"),
    "version: 1\nenforcement: observe\ntiers:\n  core:\n    description: unico tier\nsurfaces:\n  - id: s\n    path: src\n    tier: core\nprobes: []\ngates: []\n",
    "utf8"
  );
  fs.mkdirSync(path.join(sshTarget, ".sdlc"), { recursive: true });
  fs.writeFileSync(
    path.join(sshTarget, ".sdlc", "config.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        frameworkVersion: "1.0.0",
        project: { name: "Demo SSH", slug: "demo-ssh" },
        mode: "greenfield",
        surfaces: [],
        gitFlow: { integrationBranch: "main", stableBranch: "main" },
        openspec: { profile: "minimal" },
        // Declarado como UID con nombre, que es lo que documentaba el framework:
        // con SSH git reporta solo el principal y antes esto no podia pasar nunca.
        governance: { threatModel: "single-maintainer", maintainers: [{ signer: `SSH Signer <${SSH_PRINCIPAL}>` }] }
      },
      null,
      2
    ),
    "utf8"
  );
  gitSsh(["add", "."]);
  gitSsh(["commit", "--quiet", "-m", "base ssh"]);
} catch (error) {
  sshReady = false;
  console.log(`signoff ssh e2e: SKIP (${error.message.split("\n")[0]})`);
}

if (sshReady) {
  const sshCreate = JSON.parse(
    runCli(["signoff", "--target", sshTarget, "--slice", "slice-ssh", "--phase", "F13", "--create", "--json"]).stdout
  );
  assert.equal(sshCreate.status, "ok", JSON.stringify(sshCreate));

  const sshVerify = JSON.parse(
    runCli(["signoff", "--target", sshTarget, "--slice", "slice-ssh", "--phase", "F13", "--verify", "--commit", sshCreate.commitSha, "--json"])
      .stdout
  );
  assert.equal(sshVerify.status, "ok", JSON.stringify(sshVerify));
  assert.equal(sshVerify.signer, SSH_PRINCIPAL, "con SSH, %GS es el principal de allowed_signers");
  assert.equal(sshVerify.fresh, true);

  console.log("signoff ssh e2e (principal vs uid): PASS");
}
