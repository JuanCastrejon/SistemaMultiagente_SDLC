// ---------------------------------------------------------------------------
// `print` solo sabia renderizar `message` e `items`. Los payloads que devuelven
// datos estructurados no traen ninguno de los dos, asi que sin `--json` el
// comando salia MUDO. `sdlc signoff --slice X --phase F --create --record` no
// decia ni que firmo, ni que bloqueo, ni por que: exit code correcto e
// invisible. En el repo consumidor el lead lo corrio dos veces, no vio nada y
// reporto la fase firmada; no existia commit de atestacion en ninguna ref, tag,
// worktree ni working tree.
//
// Lo que este test fija no es el texto exacto, es la propiedad: NINGUN
// subcomando puede terminar sin decir que paso, y `signoff` tiene que decir
// ademas si el commit de atestacion existe -- incluido el caso real en que se
// creo y aun asi el comando bloquea.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { renderHuman } from "../src/cli.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-human-out-"));

// --- unidad: ninguna forma de payload se renderiza vacia --------------------

// El caso que provoco el arreglo. `--create --record` bloqueado por
// `governance-maintainers-missing`: sin `message`, la rama sin `--json` no
// imprimia una sola linea.
const bloqueado = {
  status: "blocked",
  created: false,
  recorded: false,
  code: "governance-maintainers-missing",
  detail: "config.governance.maintainers esta vacio: la firma no podria verificarse contra nadie, asi que no se crea"
};
const textoBloqueado = renderHuman(bloqueado, "signoff");
assert.notEqual(textoBloqueado.trim(), "", "un bloqueo de signoff no puede renderizarse vacio");
assert.match(textoBloqueado, /governance-maintainers-missing/, "el code tiene que salir");
assert.match(textoBloqueado, /maintainers esta vacio/, "el detail tiene que salir");
assert.match(textoBloqueado, /no se creo ni se enlazo nada/, "tiene que decir que no hay firma");

// Contracara: el mismo payload SIN el renderizador de signoff seguiria mudo si
// `print` no tuviera vuelco generico. Fijar que el generico tampoco calla.
const textoGenerico = renderHuman(bloqueado, "otro-comando");
assert.notEqual(textoGenerico.trim(), "", "el vuelco generico tampoco puede quedarse mudo");
assert.match(textoGenerico, /governance-maintainers-missing/, "el generico tiene que dar el code");
assert.match(textoGenerico, /maintainers esta vacio/, "el generico tiene que dar el detail: el code solo no dice que hacer");

// Los tres codigos de bloqueo que el consumidor se encuentra de verdad.
for (const code of ["signoff-worktree-dirty", "signoff-empty-subject", "signoff-commit-missing"]) {
  const texto = renderHuman(
    { status: "blocked", created: false, ok: false, code, detail: `detalle de ${code}` },
    "signoff"
  );
  assert.match(texto, new RegExp(code), `${code} tiene que aparecer en la salida humana`);
  assert.match(texto, new RegExp(`detalle de ${code}`), `el detail de ${code} tiene que aparecer`);
}

// Exito completo: sha entero (no truncado: es lo que se pega en el YAML de
// evidencia), firmante y evidencia enlazada.
const shaOk = "0123456789abcdef0123456789abcdef01234567";
const textoOk = renderHuman(
  {
    status: "ok",
    created: true,
    ok: true,
    commitSha: shaOk,
    subjectSha256: "deadbeef",
    // `message` en el payload de exito es el CUERPO DEL COMMIT de atestacion,
    // no un mensaje para humanos: la rama generica lo imprimiria como si lo
    // fuera. Aqui se comprueba que no se cuela.
    message: "chore(signoff): slice-cli F13\n\nSDLC-Signoff-Subject-SHA256: deadbeef",
    subject: { slice: "slice-cli", phase: "F13", tree_hash: "abcdef0123456789" },
    files: 3,
    recorded: true,
    evidence: ".github/agent-state/evidence/slice-cli/F13.yaml",
    signer: "Lead <lead@example.com>"
  },
  "signoff"
);
assert.match(textoOk, /CREADO/, "el exito tiene que decir que el commit se creo");
assert.match(textoOk, new RegExp(shaOk), "el sha completo tiene que salir");
assert.match(textoOk, /slice-cli/, "el slice tiene que salir");
assert.match(textoOk, /F13/, "la fase tiene que salir");
assert.match(textoOk, /Lead <lead@example\.com>/, "el firmante tiene que salir");
assert.match(textoOk, /F13\.yaml/, "la evidencia enlazada tiene que salir");
assert.doesNotMatch(textoOk, /SDLC-Signoff-Subject-SHA256/, "el cuerpo del commit NO es la salida humana");
assert.doesNotMatch(textoOk, /no se creo/, "jamas decir que no se creo cuando SI se creo");

// `--create` sin `--record`: el commit existe pero el gate va a seguir
// bloqueando. Callarse eso es como no imprimir nada.
const textoSinRecord = renderHuman(
  { status: "ok", created: true, ok: true, commitSha: shaOk, subject: { slice: "s", phase: "F13", tree_hash: "aa" } },
  "signoff"
);
assert.match(textoSinRecord, /--record/, "hay que avisar de que falta --record");
assert.match(textoSinRecord, /CREADO/);

// El caso peligroso: el commit SI se creo y aun asi el comando bloquea porque
// no se pudo enlazar. Decir "no se creo nada" aqui manda al usuario a firmar
// otra vez y deja dos commits de aprobacion para la misma cosa.
const textoCreadoNoEnlazado = renderHuman(
  {
    status: "blocked",
    created: true,
    ok: true,
    commitSha: shaOk,
    subject: { slice: "s", phase: "F13", tree_hash: "aa" },
    recorded: false,
    code: "evidence-unparseable",
    detail: "el commit se creo pero NO se enlazo con la evidencia: YAML ilegible"
  },
  "signoff"
);
assert.match(textoCreadoNoEnlazado, /SI se creo/, "tiene que afirmar que el commit existe");
assert.match(textoCreadoNoEnlazado, new RegExp(shaOk), "y dar su sha para poder enlazarlo a mano");
assert.doesNotMatch(textoCreadoNoEnlazado, /no se creo ni se enlazo nada/, "seria falso");

// Excepcion en punto indeterminado: no hay `created`. Ahi no se puede afirmar
// ninguna de las dos cosas -- afirmar de mas es el error que este arreglo
// persigue, en el otro sentido.
const textoIndeterminado = renderHuman({ status: "error", message: "EACCES: permission denied" }, "signoff");
assert.match(textoIndeterminado, /sin poder confirmar/, "no se afirma lo que no se sabe");
assert.match(textoIndeterminado, /EACCES/, "el error real tiene que salir igualmente");
assert.doesNotMatch(textoIndeterminado, /no se creo ni se enlazo nada/);

// Compatibilidad: los payloads que YA imprimian algo lo siguen imprimiendo
// igual, sin campos de mas. Un vuelco generico encima de `message` convertiria
// `sdlc help` en un volcado de estructura.
assert.equal(renderHuman({ status: "ok", message: "Uso: sdlc ..." }, "help"), "Uso: sdlc ...");
assert.equal(
  renderHuman({ status: "ok", message: "cabecera", items: ["uno", "dos"] }, "doctor"),
  "cabecera\n- uno\n- dos"
);

// Vuelco generico: nada se pierde y nada sale vacio.
const textoEstructurado = renderHuman(
  {
    status: "no-go",
    ready: false,
    governance: { status: "ok", findings: [] },
    tools: { status: "warning", findings: [{ level: "warning", code: "tool-missing", detail: "falta gh" }] },
    slices: ["S1", "S2"]
  },
  "status"
);
assert.match(textoEstructurado, /no-go/);
assert.match(textoEstructurado, /ready: false/);
assert.match(textoEstructurado, /tool-missing/, "los findings anidados no se pierden");
assert.match(textoEstructurado, /- S1/, "las listas de strings salen como items");
assert.match(textoEstructurado, /findings: \(vacio\)/, "una lista vacia se dice, no se omite");

// Limites: ni un payload vacio ni uno nulo pueden producir salida vacia.
assert.notEqual(renderHuman({}, "cualquiera").trim(), "", "{} tiene que renderizar algo");
assert.notEqual(renderHuman({}, "signoff").trim(), "", "{} de signoff tiene que renderizar algo");

console.log("render humano (unidad): PASS");

// --- E2E: ningun subcomando del CLI sale mudo -------------------------------
const target = path.join(tempRoot, "consumer");
fs.mkdirSync(target, { recursive: true });
const git = (args) => execFileSync("git", args, { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
git(["init", "--quiet"]);
git(["config", "user.email", "audit@example.com"]);
git(["config", "user.name", "Audit"]);
execFileSync("node", [cli, "install", "--target", target, "--mode", "greenfield", "--project-name", "Demo", "--json"], {
  stdio: "ignore"
});
git(["add", "-A"]);
git(["commit", "--quiet", "-m", "install"]);

function runCli(args) {
  const result = spawnSync("node", [cli, ...args], { cwd: repoRoot, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// Todo subcomando que devuelve datos estructurados. Los que exigen argumentos
// que no se le pasan aqui igual tienen que decir que les falta.
const subcomandos = [
  ["diff", "--target", target],
  ["status", "--target", target],
  ["doctor", "--target", target],
  ["governance-check", "--target", target],
  ["tools-doctor", "--target", target],
  ["verdict", "--target", target],
  ["session-start", "--target", target],
  ["resume", "--target", target],
  ["continua", "--target", target],
  ["memory-sync", "--target", target],
  ["validate-runtime", "--target", target],
  ["coverage-diff", "--target", target],
  ["quality-docs", "--target", target],
  ["skill-lesson", "--target", target],
  ["migrate-config", "--target", target],
  ["prune-backups", "--target", target],
  ["upgrade", "--target", target],
  ["phase-gate", "--target", target],
  ["quality-gate", "--target", target],
  ["quality-baseline", "--target", target],
  ["acceptance-verify", "--target", target],
  ["red-proof-verify", "--target", target],
  ["change-close", "--target", target],
  ["pr-body-check", "--target", target],
  ["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--create"],
  ["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--create", "--record"],
  ["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--record"],
  ["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--verify"],
  ["help"]
];

for (const args of subcomandos) {
  const { stdout, stderr } = runCli(args);
  assert.notEqual(
    `${stdout}${stderr}`.trim(),
    "",
    `\`sdlc ${args.filter((a) => a !== target).join(" ")}\` salio MUDO sin --json`
  );
}
console.log(`ningun subcomando mudo sin --json (${subcomandos.length} invocaciones): PASS`);

// --- Contracara: --json no cambia de forma ni de stream ---------------------
// El humano es para el humano; toda la automatizacion lee JSON por stdout.
for (const args of [
  ["governance-check", "--target", target, "--json"],
  ["diff", "--target", target, "--json"],
  ["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--create", "--json"]
]) {
  const { stdout, stderr } = runCli(args);
  const payload = JSON.parse(stdout);
  assert.ok(payload.status, "el JSON conserva su forma");
  assert.equal(stderr.trim(), "", "con --json no se escribe nada por stderr");
}
console.log("--json intacto por stdout: PASS");

// --- Los codigos de bloqueo salen SIN --json --------------------------------
const dirtyPath = path.join(target, "src");
fs.mkdirSync(dirtyPath, { recursive: true });
fs.writeFileSync(path.join(dirtyPath, "index.js"), "export const x = 1;\n", "utf8");
fs.writeFileSync(
  path.join(target, "quality-contract.yaml"),
  "version: 1\nenforcement: observe\ntiers:\n  core:\n    description: unico tier\nsurfaces:\n  - id: s\n    path: src\n    tier: core\nprobes: []\ngates: []\n",
  "utf8"
);
const sucio = runCli(["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--create"]);
assert.match(sucio.stderr, /signoff-worktree-dirty/, "el arbol sucio se nombra por su code");
assert.equal(sucio.stdout.trim(), "", "un fallo no ensucia stdout");
assert.notEqual(sucio.status, 0);

const sinCommit = runCli(["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--record"]);
assert.match(sinCommit.stderr, /signoff-commit-missing/, "--record sin --create se nombra por su code");

git(["add", "-A"]);
git(["commit", "--quiet", "-m", "contenido"]);
// Superficie que resuelve a cero archivos: el sujeto quedaria vacio.
fs.writeFileSync(
  path.join(target, "quality-contract.yaml"),
  "version: 1\nenforcement: observe\ntiers:\n  core:\n    description: unico tier\nsurfaces:\n  - id: s\n    path: no-existe\n    tier: core\nprobes: []\ngates: []\n",
  "utf8"
);
git(["add", "-A"]);
git(["commit", "--quiet", "-m", "superficie fantasma"]);
const vacio = runCli(["signoff", "--target", target, "--slice", "S1", "--phase", "F13", "--create"]);
assert.match(vacio.stderr, /signoff-empty-subject/, "la superficie vacia se nombra por su code");
console.log("codigos de bloqueo visibles sin --json: PASS");

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log("cli-human-output: PASS");
