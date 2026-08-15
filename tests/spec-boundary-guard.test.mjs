// ---------------------------------------------------------------------------
// P2 (ADR 0007): el guard de frontera de especificacion debe protegerse a si
// mismo. Tres huecos reales, los tres explotables sin dejar rastro:
//
// 1. Un locked-paths.txt custom REEMPLAZABA la lista default entera (en vez
//    de extenderla): agregar una ruta propia tiraba sin querer la proteccion
//    de quality-contract.yaml y el resto.
// 2. El script del guard, su propia config y su propia allowlist no estaban
//    en ninguna lista: reescribirlos no se detectaba.
// 3. `git diff` es ciego a archivos nuevos que nunca se agregaron al indice:
//    crear un spec o una config protegida sin `git add` pasaba en silencio.
//
// (1) y (2) por si solas no alcanzan si el codigo que se ejecuta es el que el
// PR corrompio -- por eso el fix real en CI (quality-verify.yml) corre la
// copia del guard que vive en la rama de integracion, no la del checkout del
// PR. Este test reproduce exactamente ese patron: SIEMPRE ejecuta la copia
// confiable (origin/main), nunca la corrompida del working tree.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guardSource = path.join(repoRoot, "templates", "scripts", "validate-spec-boundary.mjs");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-spec-boundary-"));
const target = path.join(tempRoot, "consumidor");
const trustedCopy = path.join(tempRoot, "trusted-guard.mjs");

function git(args) {
  return execFileSync("git", args, { cwd: target, encoding: "utf8" });
}
// Mismo patron que el fix de CI: la copia que se EJECUTA sale de origin/main,
// nunca del working tree del "PR" (que en los casos de abajo esta corrompido
// a proposito). El resto de las opciones (locked-paths.txt, la allowlist) SI
// se leen del working tree, porque eso es seguro: solo pueden sumar rutas.
function runTrustedGuard() {
  // La ref va CALIFICADA, igual que en el workflow: con el nombre corto, un tag
  // o una rama local llamados `origin/main` ganan a la remota por las reglas
  // DWIM de gitrevisions, y entonces la copia "confiable" sale del arbol del
  // atacante. El caso 16 lo reproduce.
  fs.writeFileSync(trustedCopy, git(["show", "refs/remotes/origin/main:scripts/validate-spec-boundary.mjs"]), "utf8");
  const result = spawnSync("node", [trustedCopy, "--base", "refs/remotes/origin/main", "--json"], { cwd: target, encoding: "utf8" });
  assert.equal(result.status === 0 || result.status === 2, true, `guard crasheo: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

// --- consumidor real: guard instalado, contrato real, remoto simulado ------
fs.mkdirSync(path.join(target, "scripts"), { recursive: true });
fs.mkdirSync(path.join(target, ".github", "agent-state"), { recursive: true });
fs.copyFileSync(guardSource, path.join(target, "scripts", "validate-spec-boundary.mjs"));
fs.writeFileSync(path.join(target, "quality-contract.yaml"), "version: 1\n", "utf8");
fs.writeFileSync(path.join(target, "src.js"), "export const x = 1;\n", "utf8");

git(["init", "--quiet"]);
git(["config", "user.email", "test@example.com"]);
git(["config", "user.name", "Test"]);

// Firma SSH real. Desde 2.0.0 una excepcion del allowlist no autoriza nada
// salvo que apunte a una ATESTACION FIRMADA de verdad, asi que sin una clave no
// se puede probar el camino legitimo — y un test que solo comprueba que todo
// bloquea no prueba un control, prueba un muro.
const FIRMANTE = "guard-signer@example.com";
let firmaLista = true;
try {
  const keyPath = path.join(tempRoot, "id_ed25519_guard");
  execFileSync("ssh-keygen", ["-t", "ed25519", "-N", "", "-C", FIRMANTE, "-f", keyPath], { stdio: "ignore" });
  const allowedSigners = path.join(tempRoot, "allowed_signers_guard");
  fs.writeFileSync(allowedSigners, `${FIRMANTE} namespaces="git" ${fs.readFileSync(`${keyPath}.pub`, "utf8").trim()}\n`, "utf8");
  git(["config", "gpg.format", "ssh"]);
  git(["config", "user.signingkey", `${keyPath}.pub`.replace(/\\/g, "/")]);
  git(["config", "gpg.ssh.allowedSignersFile", allowedSigners.replace(/\\/g, "/")]);
  git(["config", "user.email", FIRMANTE]);
} catch (error) {
  firmaLista = false;
  console.log(`spec-boundary: firma SSH no disponible (${String(error.message).split("\n")[0]})`);
}

// Los mantenedores salen de la BASE. Sin esta lista, `approved_by` no tiene
// contra que cotejarse y ninguna excepcion puede ser valida.
fs.mkdirSync(path.join(target, ".sdlc"), { recursive: true });
fs.writeFileSync(
  path.join(target, ".sdlc", "config.json"),
  JSON.stringify({ schemaVersion: 1, governance: { maintainers: [{ name: "Guard Signer", signer: FIRMANTE }] } }, null, 2),
  "utf8"
);

git(["add", "."]);
git(["commit", "--quiet", "-m", "base"]);
// El guard resuelve la base contra una ref REMOTA a proposito (una rama local
// se puede reescribir); se simula sin remoto real apuntando el ref al HEAD.
// Esta ref queda FIJA: representa la rama de integracion protegida, y ningun
// caso de abajo la vuelve a mover.
git(["update-ref", "refs/remotes/origin/main", "HEAD"]);

// --- 1. caso base: tocar una ruta protegida por defecto se detecta ----------
fs.writeFileSync(path.join(target, "quality-contract.yaml"), "version: 2\n", "utf8");
const baseline = runTrustedGuard();
assert.equal(baseline.status, "blocked");
assert.ok(baseline.violations.some((v) => v.path === "quality-contract.yaml"));
git(["checkout", "--", "quality-contract.yaml"]);

// --- 2. el PR neutraliza su propia copia del guard: la copia confiable igual
// lo detecta, porque scripts/validate-spec-boundary.mjs esta en ALWAYS_LOCKED
// y quien juzga es origin/main, no el checkout corrompido.
fs.writeFileSync(path.join(target, "scripts", "validate-spec-boundary.mjs"), "process.exit(0);\n", "utf8");
const selfEdit = runTrustedGuard();
assert.equal(selfEdit.status, "blocked");
assert.ok(
  selfEdit.violations.some((v) => v.path === "scripts/validate-spec-boundary.mjs"),
  "neutralizar la copia local del guard no debe evitar que la copia confiable lo detecte"
);
git(["checkout", "--", "scripts/validate-spec-boundary.mjs"]);

// --- 3. auto-proteccion: la propia allowlist tambien esta protegida --------
fs.writeFileSync(
  path.join(target, ".github", "agent-state", "spec-boundary-allowlist.yaml"),
  "- path: quality-contract.yaml\n",
  "utf8"
);
const allowlistEdit = runTrustedGuard();
assert.equal(allowlistEdit.status, "blocked");
assert.ok(
  allowlistEdit.violations.some((v) => v.path === ".github/agent-state/spec-boundary-allowlist.yaml"),
  "declararse la propia excepcion no puede ser gratis: el cambio a la allowlist requiere revision humana tambien"
);
git(["clean", "-fd", ".github"]);

// --- 4. el bug real: un locked-paths.txt custom NO puede vaciar defaults ---
// Se comitea (no solo se escribe) porque asi llegaria en un PR real; ademas
// prueba de paso que un archivo NUEVO Y STAGEADO se ve.
fs.mkdirSync(path.join(target, ".sdlc"), { recursive: true });
fs.writeFileSync(path.join(target, ".sdlc", "locked-paths.txt"), "docs/algo-propio.md\n", "utf8");
fs.writeFileSync(path.join(target, "quality-contract.yaml"), "version: 3\n", "utf8");
const withCustomList = runTrustedGuard();
assert.equal(withCustomList.status, "blocked");
assert.ok(
  withCustomList.violations.some((v) => v.path === "quality-contract.yaml"),
  "un locked-paths.txt custom debe EXTENDER la proteccion default, no reemplazarla"
);
assert.ok(
  withCustomList.violations.some((v) => v.path === ".sdlc/locked-paths.txt"),
  "el propio locked-paths.txt esta en ALWAYS_LOCKED: crearlo sin comitearlo no lo esconde"
);
git(["checkout", "--", "quality-contract.yaml"]);
fs.rmSync(path.join(target, ".sdlc", "locked-paths.txt"));

// --- 5. archivo nuevo protegido, NUNCA agregado al indice ------------------
// `git diff` (con o sin --cached) es ciego a esto: solo `git status
// --porcelain` lo ve. Antes del fix, crear un spec sin `git add` pasaba
// limpio.
fs.mkdirSync(path.join(target, "openspec", "specs"), { recursive: true });
fs.writeFileSync(path.join(target, "openspec", "specs", "nuevo.md"), "# spec\n", "utf8");
const untracked = runTrustedGuard();
assert.equal(untracked.status, "blocked");
assert.ok(
  untracked.violations.some((v) => v.path === "openspec/specs/nuevo.md"),
  "un archivo nuevo sin git add en una ruta protegida no puede ser invisible para el guard"
);
fs.rmSync(path.join(target, "openspec"), { recursive: true });

// --- 6. sin cambios en rutas protegidas: pasa limpio -----------------------
fs.writeFileSync(path.join(target, "src.js"), "export const x = 2;\n", "utf8");
const clean = runTrustedGuard();
assert.equal(clean.status, "ok");
assert.equal(clean.violations.length, 0);

// --- 7. EL EXPLOIT: allowlist autorreferencial en el mismo PR --------------
// Encontrado por auditoria adversarial DESPUES de que el checkpoint declarara
// P2 cerrado, y reproducido empiricamente. El caso 2 ya cubria la mitad del
// vector (el SCRIPT del guard se trae de la base), pero el script confiable
// seguia leyendo los DATOS —el allowlist— del checkout atacante-controlado.
//
// El ataque cabe en UN commit: reescribir un archivo protegido y, a la vez,
// agregar al allowlist dos entradas — una que autoriza ese archivo y otra
// autorreferencial que autoriza el propio allowlist. Antes del fix esto daba
// `status: ok, violations: []` con ambos archivos en `allowed`: el evaluado
// firmandose su propio permiso.
fs.mkdirSync(path.join(target, "openspec", "specs", "algo"), { recursive: true });
// El caso 3 dejo `git clean -fd .github`: hay que recrear el directorio.
fs.mkdirSync(path.join(target, ".github", "agent-state"), { recursive: true });
fs.writeFileSync(path.join(target, "openspec", "specs", "algo", "spec.md"), "spec REESCRITO por el agente\n", "utf8");
fs.writeFileSync(
  path.join(target, ".github", "agent-state", "spec-boundary-allowlist.yaml"),
  [
    "version: 1",
    "allowlist:",
    "  - path: openspec/specs/algo/spec.md",
    "    approved_by: nadie-real",
    "    review_id: inventado",
    "  - path: .github/agent-state/spec-boundary-allowlist.yaml",
    "    approved_by: nadie-real",
    "    review_id: inventado",
    ""
  ].join("\n"),
  "utf8"
);
const selfApproved = runTrustedGuard();
assert.equal(selfApproved.status, "blocked", JSON.stringify(selfApproved));
assert.ok(
  selfApproved.violations.some((v) => v.path === "openspec/specs/algo/spec.md"),
  "una entrada de allowlist creada en el MISMO PR no puede autorizar nada: solo cuenta si ya esta mergeada en la base"
);
assert.ok(
  selfApproved.violations.some((v) => v.path === ".github/agent-state/spec-boundary-allowlist.yaml"),
  "la entrada autorreferencial tampoco se autoriza a si misma"
);
assert.equal(selfApproved.allowed.length, 0, "ninguna excepcion puede concederse desde el checkout");
assert.equal(selfApproved.allowlistEntries, 0, "el allowlist efectivo es el de la BASE, que aqui esta vacio");
git(["clean", "-fd", "openspec", ".github"]);

// --- 8. la contracara: una excepcion COMPLETA y mergeada en la base SI vale -
// Sin esto el fix seria inutil (bloquear siempre no es un control, es un muro).
// Desde 2.0.0 "completa" significa las cuatro cosas: `path`, `approved_by` de
// governance.maintainers, `attestation_commit` que verifica como commit firmado
// por ese mismo mantenedor, y `expires_at` en el futuro.
let attestationSha = null;
if (firmaLista) {
  fs.mkdirSync(path.join(target, "openspec", "specs", "algo"), { recursive: true });
  fs.mkdirSync(path.join(target, ".github", "agent-state"), { recursive: true });
  fs.writeFileSync(path.join(target, "openspec", "specs", "algo", "spec.md"), "spec original\n", "utf8");
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "spec original"]);
  // La atestacion: commit vacio FIRMADO, igual que el que emite
  // `sdlc signoff --create`.
  git(["commit", "--quiet", "--allow-empty", "-S", "-m", "atestacion de la excepcion"]);
  attestationSha = git(["rev-parse", "HEAD"]).trim();
  fs.writeFileSync(
    path.join(target, ".github", "agent-state", "spec-boundary-allowlist.yaml"),
    [
      "version: 1",
      "allowlist:",
      "  - path: openspec/specs/algo/spec.md",
      "    reason: correccion aprobada en revision",
      `    approved_by: ${FIRMANTE}`,
      `    attestation_commit: ${attestationSha}`,
      "    expires_at: 2099-12-31T00:00:00Z",
      ""
    ].join("\n"),
    "utf8"
  );
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "excepcion aprobada y mergeada en la base"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]); // la base avanza CON la excepcion dentro
  fs.writeFileSync(path.join(target, "openspec", "specs", "algo", "spec.md"), "spec actualizado bajo excepcion vigente\n", "utf8");
  const underValidException = runTrustedGuard();
  assert.equal(underValidException.status, "ok", JSON.stringify(underValidException));
  assert.ok(
    underValidException.allowed.some((entry) => entry.path === "openspec/specs/algo/spec.md"),
    "una excepcion completa, firmada y vigente que vive en la base debe conceder el permiso"
  );
  git(["checkout", "--", "openspec/specs/algo/spec.md"]);
} else {
  console.log("spec-boundary excepcion valida: SKIP (sin firma SSH en esta maquina)");
}

// --- 9. RENAME: sacar un archivo protegido de su ruta protegida -----------
// `git diff --name-only` con la deteccion de renames que git trae activa por
// defecto imprime SOLO la ruta destino; la origen desaparece. Antes de
// `--no-renames`, `git mv openspec/specs/x.md notas/x.md` daba `status: ok,
// violations: 0`: el criterio contra el que se juzga al agente se podia BORRAR
// del arbol protegido sin dejar rastro, y lo mismo valia para los tres
// archivos de ALWAYS_LOCKED (incluido el propio guard).
fs.mkdirSync(path.join(target, "openspec", "specs"), { recursive: true });
fs.writeFileSync(path.join(target, "openspec", "specs", "movible.md"), "criterio original\n", "utf8");
git(["add", "-A"]);
git(["commit", "--quiet", "-m", "spec que el atacante querra mover"]);
git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
fs.mkdirSync(path.join(target, "notas"), { recursive: true });
git(["mv", "openspec/specs/movible.md", "notas/movible.md"]);
const renamed = runTrustedGuard();
assert.equal(renamed.status, "blocked", JSON.stringify(renamed));
assert.ok(
  renamed.violations.some((v) => v.path === "openspec/specs/movible.md"),
  "mover un archivo protegido fuera de su ruta protegida tiene que verse: la ruta ORIGEN es la que importa"
);
git(["reset", "--hard", "HEAD"]);
git(["clean", "-fd", "notas"]);

// --- 10. RUTA CON TILDE: el corpus de este framework esta en espanol -------
// `core.quotePath` viene activo por defecto y hace que git imprima
// `"openspec/specs/facturaci\303\263n/spec.md"` — entrecomillado y en octal.
// matchesPattern compara con startsWith, asi que la comilla inicial rompia el
// prefijo y TODO lo que colgara de un directorio con tilde quedaba fuera del
// guard de forma permanente y silenciosa.
const acentuado = path.join(target, "openspec", "specs", "facturación");
fs.mkdirSync(acentuado, { recursive: true });
fs.writeFileSync(path.join(acentuado, "spec.md"), "criterio con tilde\n", "utf8");
const conTilde = runTrustedGuard();
assert.equal(conTilde.status, "blocked", JSON.stringify(conTilde));
assert.ok(
  conTilde.violations.some((v) => v.path.includes("facturaci")),
  "una ruta con caracteres no-ASCII no puede quedar invisible para el guard"
);
fs.rmSync(acentuado, { recursive: true, force: true });

// --- 11. BASE IRRESOLUBLE: no medir no es aprobar --------------------------
// Antes devolvia `status: skipped` con exit 0 — verde — mientras su propio
// detail admitia que no podia comparar contra nada verificable.
// `resolveBase` cae a origin/develop y origin/main si el --base explicito no
// resuelve, asi que para probar la condicion real hay que dejar el repo sin
// NINGUNA ref remota — el caso del checkout superficial o del consumidor cuya
// rama de integracion se renombro.
const savedOriginMain = git(["rev-parse", "refs/remotes/origin/main"]).trim();
git(["update-ref", "-d", "refs/remotes/origin/main"]);
const sinBase = spawnSync("node", [trustedCopy, "--base", "origin/no-existe", "--json"], { cwd: target, encoding: "utf8" });
git(["update-ref", "refs/remotes/origin/main", savedOriginMain]);
assert.equal(sinBase.status, 2, "un guard que no puede comparar debe bloquear, no pasar");
assert.equal(JSON.parse(sinBase.stdout).code, "spec-boundary-base-unresolvable");

// ===========================================================================
// Ronda 16. Todo lo de abajo salio de una auditoria adversarial que reprodujo
// cada caso contra el guard real antes de reportarlo.
// ===========================================================================

// Escribe una allowlist EN LA BASE y devuelve el veredicto del guard sobre un
// cambio en `rutaProtegida`. Cada caso necesita su propia base, porque el
// allowlist solo cuenta si ya esta mergeado.
function conAllowlistEnLaBase(lineas, rutaProtegida, contenido) {
  fs.mkdirSync(path.join(target, path.dirname(rutaProtegida)), { recursive: true });
  fs.writeFileSync(path.join(target, rutaProtegida), "original\n", "utf8");
  fs.writeFileSync(
    path.join(target, ".github", "agent-state", "spec-boundary-allowlist.yaml"),
    ["version: 1", ...lineas, ""].join("\n"),
    "utf8"
  );
  git(["add", "-A"]);
  git(["commit", "--quiet", "-m", "allowlist bajo prueba"]);
  git(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  fs.writeFileSync(path.join(target, rutaProtegida), contenido, "utf8");
  const veredicto = runTrustedGuard();
  git(["checkout", "--", rutaProtegida]);
  return veredicto;
}

// --- 12. una excepcion CADUCADA no autoriza -------------------------------
// El propio archivo de allowlist enuncia "toda entrada caduca... la excepcion
// se vuelve permanente por olvido, que es como mueren estos controles". Hasta
// 2.0.0 el guard no leia `expires_at`, asi que TODA entrada nacia permanente.
if (firmaLista) {
  const caducada = conAllowlistEnLaBase(
    [
      "allowlist:",
      "  - path: openspec/specs/caduca/spec.md",
      `    approved_by: ${FIRMANTE}`,
      `    attestation_commit: ${attestationSha}`,
      "    expires_at: 2020-01-01T00:00:00Z"
    ],
    "openspec/specs/caduca/spec.md",
    "reescrito bajo una excepcion vencida hace anios\n"
  );
  assert.equal(caducada.status, "blocked", JSON.stringify(caducada));
  assert.ok(
    (caducada.rejectedExceptions ?? []).some((r) => r.problemas.some((m) => m.includes("caducada"))),
    "una excepcion vencida tiene que rechazarse Y decir por que"
  );
}

// --- 13. `approved_by` que no es mantenedor no autoriza --------------------
// La regla 2 del archivo ("approved_by debe estar en la lista de mantenedores")
// no existia en el codigo: cualquier nombre, incluido uno inventado por el
// propio agente evaluado, autorizaba el cambio.
if (firmaLista) {
  const ajeno = conAllowlistEnLaBase(
    [
      "allowlist:",
      "  - path: openspec/specs/ajeno/spec.md",
      "    approved_by: atacante-no-mantenedor",
      `    attestation_commit: ${attestationSha}`,
      "    expires_at: 2099-12-31T00:00:00Z"
    ],
    "openspec/specs/ajeno/spec.md",
    "reescrito por quien no es mantenedor\n"
  );
  assert.equal(ajeno.status, "blocked", JSON.stringify(ajeno));
  assert.ok(
    (ajeno.rejectedExceptions ?? []).some((r) => r.problemas.some((m) => m.includes("governance.maintainers"))),
    "un approved_by que no esta en la lista de mantenedores no autoriza nada"
  );
}

// --- 14. `attestation_commit` inventado no autoriza ------------------------
// Cualquier cadena de 40 hex servia igual que una firma real: el campo era
// cosmetico mientras el script decia en su cabecera que la prueba de
// autorizacion es la atestacion firmada.
if (firmaLista) {
  const inventada = conAllowlistEnLaBase(
    [
      "allowlist:",
      "  - path: openspec/specs/inventada/spec.md",
      `    approved_by: ${FIRMANTE}`,
      "    attestation_commit: deadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      "    expires_at: 2099-12-31T00:00:00Z"
    ],
    "openspec/specs/inventada/spec.md",
    "reescrito con una atestacion que no existe\n"
  );
  assert.equal(inventada.status, "blocked", JSON.stringify(inventada));
  assert.ok(
    (inventada.rejectedExceptions ?? []).some((r) => r.problemas.some((m) => m.includes("historial accesible"))),
    "un attestation_commit que no esta en el historial no puede autorizar"
  );
}

// --- 15. un `path:` FUERA del bloque `allowlist:` no autoriza --------------
// El parser era una regex linea-por-linea sin nocion de YAML: casaba cualquier
// linea `path:` bajo cualquier clave. Con `allowlist: []` vacio y un bloque de
// notas, el archivo quedaba autorizado.
{
  const fuera = conAllowlistEnLaBase(
    [
      "allowlist: []",
      "notas_no_autorizantes:",
      "  - path: openspec/specs/colada/spec.md",
      "    comentario: esto es una nota, no una excepcion"
    ],
    "openspec/specs/colada/spec.md",
    "reescrito por una nota que no es una excepcion\n"
  );
  assert.equal(fuera.status, "blocked", JSON.stringify(fuera));
  assert.equal(fuera.allowlistEntries, 0, "solo cuentan los items del bloque `allowlist:`");
}

// --- 16. un TAG llamado `origin/main` no secuestra la base -----------------
// Las reglas DWIM de gitrevisions prueban refs/tags/<n> y refs/heads/<n> ANTES
// que refs/remotes/<n>. Un tag llamado literalmente `origin/main` apuntando al
// HEAD del atacante hacia que el guard comparara HEAD contra HEAD: diff vacio,
// `status: ok`, y ademas el `git show "$BASE:..."` del workflow traia la copia
// "confiable" del arbol del atacante. Las dos mitades del diseño a la vez.
fs.writeFileSync(path.join(target, "quality-contract.yaml"), "version: secuestrada\n", "utf8");
git(["add", "-A"]);
git(["commit", "--quiet", "-m", "cambio que el atacante quiere ocultar"]);
git(["tag", "origin/main", "HEAD"]);
const secuestro = spawnSync("node", [trustedCopy, "--base", "origin/main", "--json"], { cwd: target, encoding: "utf8" });
git(["tag", "-d", "origin/main"]);
const secuestrado = JSON.parse(secuestro.stdout);
assert.equal(secuestrado.status, "blocked", JSON.stringify(secuestrado));
assert.equal(
  secuestrado.base,
  "refs/remotes/origin/main",
  "la base tiene que resolverse a la ref REMOTA calificada, nunca a un tag ni a una rama local del mismo nombre"
);
git(["reset", "--hard", "refs/remotes/origin/main"]);

// --- 17. config de gate en un SUBDIRECTORIO (monorepo) --------------------
// `vitest.config` iba por prefijo de raiz, asi que en un workspace —la
// topologia normal de un consumidor— bajar `thresholds` en
// `packages/app/vitest.config.ts` no lo veia nadie.
fs.mkdirSync(path.join(target, "packages", "app"), { recursive: true });
fs.writeFileSync(path.join(target, "packages", "app", "vitest.config.ts"), "export default { coverage: 0 };\n", "utf8");
const enMonorepo = runTrustedGuard();
assert.equal(enMonorepo.status, "blocked", JSON.stringify(enMonorepo));
assert.ok(
  enMonorepo.violations.some((v) => v.path === "packages/app/vitest.config.ts"),
  "la config que fija el umbral esta protegida a cualquier profundidad, no solo en la raiz"
);
fs.rmSync(path.join(target, "packages"), { recursive: true, force: true });

// --- 18. `**` en locked-paths.txt protege de verdad -----------------------
// Cada `*` se compilaba a `[^/]*`, que nunca cruza barra: `**/algo.txt` no
// casaba NADA. Y `locked-paths.txt` es el mecanismo documentado para EXTENDER
// la proteccion, o sea justo el que un consumidor usaria para tapar el hueco
// del caso 17. Fallaba en silencio.
fs.mkdirSync(path.join(target, ".sdlc"), { recursive: true });
fs.writeFileSync(path.join(target, ".sdlc", "locked-paths.txt"), "**/politica-propia.yaml\n", "utf8");
fs.mkdirSync(path.join(target, "a", "b", "c"), { recursive: true });
fs.writeFileSync(path.join(target, "a", "b", "c", "politica-propia.yaml"), "umbral: 0\n", "utf8");
const dobleAsterisco = runTrustedGuard();
assert.equal(dobleAsterisco.status, "blocked", JSON.stringify(dobleAsterisco));
assert.ok(
  dobleAsterisco.violations.some((v) => v.path === "a/b/c/politica-propia.yaml"),
  "`**` tiene que cruzar barras: es el unico modo de extender la proteccion en profundidad"
);
fs.rmSync(path.join(target, "a"), { recursive: true, force: true });

// --- 19. un patron con demasiados comodines se RECHAZA y se dice ----------
// `*a*a*a…*b` contra una ruta larga no termina: medido, mas de 90 s sin
// resolver. No es evasion —el job muere en rojo— pero es una negacion del
// propio control, autoinfligible por quien escribe locked-paths.txt.
fs.writeFileSync(path.join(target, ".sdlc", "locked-paths.txt"), `${"*a".repeat(15)}*b\n`, "utf8");
const arrancado = Date.now();
const patologico = runTrustedGuard();
assert.ok(Date.now() - arrancado < 20_000, "el guard no puede colgarse por un patron del propio evaluado");
assert.ok(
  (patologico.rejectedPatterns ?? []).length > 0,
  "un patron rechazado tiene que REPORTARSE: un recorte silencioso se lee como cobertura completa"
);
fs.rmSync(path.join(target, ".sdlc", "locked-paths.txt"), { force: true });

// --- 20. `--allowlist` apuntado a otro archivo se rechaza -----------------
// Cualquier YAML de la base con lineas `path:` se convertia en una allowlist
// involuntaria. Solo vale la ruta que el guard se protege a si mismo.
const otraAllowlist = spawnSync(
  "node",
  [trustedCopy, "--base", "refs/remotes/origin/main", "--allowlist", "quality-contract.yaml", "--json"],
  { cwd: target, encoding: "utf8" }
);
assert.equal(otraAllowlist.status, 2, "apuntar el allowlist a otro archivo tiene que bloquear");
assert.equal(JSON.parse(otraAllowlist.stdout).code, "spec-boundary-allowlist-invalida");

// --- 21. la FUENTE del guard esta protegida bajo cualquier raiz -----------
// `ALWAYS_LOCKED` comparaba con startsWith, asi que el prefijo `templates/`
// sacaba del alcance la fuente del guard de TODOS los consumidores: quien
// trabaja en el framework podia vaciar DEFAULT_LOCKED sin dejar rastro.
fs.mkdirSync(path.join(target, "templates", "scripts"), { recursive: true });
fs.writeFileSync(path.join(target, "templates", "scripts", "validate-spec-boundary.mjs"), "process.exit(0);\n", "utf8");
const fuenteDelGuard = runTrustedGuard();
assert.equal(fuenteDelGuard.status, "blocked", JSON.stringify(fuenteDelGuard));
assert.ok(
  fuenteDelGuard.violations.some((v) => v.path === "templates/scripts/validate-spec-boundary.mjs"),
  "la fuente del guard esta protegida por SUFIJO: da igual bajo que raiz viva"
);
fs.rmSync(path.join(target, "templates"), { recursive: true, force: true });

// --- 22. un directorio que casa un patron con barra final ------------------
// `openspec/changes/*/specs/` compilaba a un regex que exigia la barra, asi que
// si `specs` era un SYMLINK o un submodulo —git reporta la ruta sin barra— el
// arbol entero salia del alcance y el criterio se mudaba a un hermano libre.
fs.mkdirSync(path.join(target, "openspec", "changes", "mi"), { recursive: true });
fs.writeFileSync(path.join(target, "openspec", "changes", "mi", "specs"), "no soy un directorio\n", "utf8");
const comoArchivo = runTrustedGuard();
assert.equal(comoArchivo.status, "blocked", JSON.stringify(comoArchivo));
assert.ok(
  comoArchivo.violations.some((v) => v.path === "openspec/changes/mi/specs"),
  "un patron con barra final tiene que casar tambien la ruta exacta sin barra"
);
fs.rmSync(path.join(target, "openspec", "changes", "mi"), { recursive: true, force: true });

console.log("spec-boundary-guard: PASS");
