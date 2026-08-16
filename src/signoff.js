// ---------------------------------------------------------------------------
// Firma humana verificable por signed-attestation (ADR 0007, decisiones 1 y 4
// del cierre de decisiones)
//
// Decision 1: "nadie lee el codigo" en money_path NO se acepta tal cual. La
// firma sigue siendo obligatoria en tier core/money_path, pero no puede
// pedirse como review de plataforma: con un solo maintainer, GitHub prohibe
// aprobar tu propio PR — platform-review es insatisfacible, no es una opcion
// mas estricta, es una que nunca puede pasar. La alternativa que SI se puede
// verificar sin depender de la plataforma: un commit vacio, firmado
// (GPG/SSH), cuyo mensaje declara EXACTAMENTE que se aprueba.
//
// Que verifica este modulo, y que NO verifica:
//  - SI verifica: la firma criptografica es valida (`git verify-commit`), el
//    firmante esta en la lista de maintainers, el commit es antepasado de la
//    rama que se esta evaluando (no un commit firmado en otro lado que nunca
//    entro a esta historia), y el `subject_sha256` declarado coincide con lo
//    que se le pidio aprobar (una firma vieja no sirve para contenido nuevo).
//  - NO verifica: que el humano leyo el codigo de verdad. Eso es justo lo que
//    el ADR acepta no poder verificar tecnicamente — por eso la politica de
//    fraude y `evidence-mismatch` (P4) son la contramedida complementaria,
//    no este modulo.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { sha256Text, spawnCapture, stableJson } from "./file-utils.js";
import { computeContractSha256AtRef, computePhaseContractSha256AtRef } from "./evidence-writer.js";

export const ATTESTATION_TRAILER = "Signed-Attestation-Subject";

const TRAILER_PATTERN = new RegExp(`^${ATTESTATION_TRAILER}:\\s*([a-f0-9]{64})\\s*$`, "m");

// El sujeto es lo que el humano aprueba (tipicamente { slice, phase, tree_hash
// }): un objeto plano de valores primitivos, asi que stableJson alcanza sin
// necesitar un serializador recursivo propio.
export function computeSubjectSha256(subject) {
  return sha256Text(stableJson(subject));
}

/**
 * EL sujeto. Un solo sitio donde se arma (ADR 0008, D3).
 *
 * Antes se construia inline en SEIS lugares —cuatro en `cli.js`, dos en
 * `harness.js`— y añadir un campo a mano en los seis es exactamente el defecto
 * que esta rama ha cometido cuatro veces: arreglar una ocurrencia y dejar las
 * hermanas. Peor aqui que en un README: si `signoff` firma un sujeto y
 * `phase-gate` recompone otro, la firma no verifica y el mensaje no dice por
 * que.
 *
 * `ref` es el ref ATESTADO, no el working tree: es el mismo ref con el que se
 * calculo `treeHash`, y pasarlos desalineados produciria un sujeto que no
 * corresponde a ningun estado real del repo.
 */
export function buildSubject({ target, ref, slice, phase, treeHash }) {
  const contrato = computeContractSha256AtRef(target, ref);
  if (!contrato.ok) return { ok: false, code: contrato.code, detail: contrato.detail, subject: null };
  const fases = computePhaseContractSha256AtRef(target, ref);
  if (!fases.ok) return { ok: false, code: fases.code, detail: fases.detail, subject: null };
  return {
    ok: true,
    code: null,
    detail: null,
    subject: {
      slice,
      phase,
      tree_hash: treeHash,
      contract_sha256: contrato.hash,
      phase_contract_sha256: fases.hash
    }
  };
}

// El sujeto v1, el que emitia 1.x: sin `contract_sha256`. No se usa para firmar
// NADA — existe solo para poder reconocer una atestacion antigua y decir "hay
// que re-firmar" en vez de "esto no coincide". Devuelve null si el sujeto no
// tiene la forma esperada, para no inventar una comparacion.
export function subjectV1(subject) {
  if (!subject || typeof subject !== "object") return null;
  const { slice, phase, tree_hash: treeHash } = subject;
  if (slice === undefined || phase === undefined || treeHash === undefined) return null;
  return { slice, phase, tree_hash: treeHash };
}

export function buildAttestationMessage({ slice, phase, subjectSha256 }) {
  return [`signoff(${phase}): ${slice}`, "", `${ATTESTATION_TRAILER}: ${subjectSha256}`].join("\n");
}

export function parseAttestationMessage(message) {
  const match = TRAILER_PATTERN.exec(String(message ?? ""));
  return match ? { subjectSha256: match[1] } : null;
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim(), stderr: result.stderr ?? "" };
}

// Misma invocacion sin bloquear el hilo, y con la MISMA semantica que `git()`:
// `spawnCapture` acumula buffers, decodifica una sola vez y aplica el mismo
// limite de 1 MiB que `spawnSync` trae por defecto. Que las dos vias coincidan
// no es cosmetico — si difieren, la auditoria y el gate pueden juzgar distinto
// la misma firma, y eso es un fallo de seguridad silencioso.
export async function gitAsync(args, cwd) {
  const result = await spawnCapture("git", args, { cwd });
  return { ok: result.ok, stdout: result.stdout.trim(), stderr: result.stderr };
}

// El SHA-256 de la cadena vacia. Es lo que devuelve un hash de arbol cuando
// NINGUNA superficie declarada resuelve a archivos — el caso de los
// placeholders `apps/api` y `apps/web` que deja el instalador. Una firma
// emitida sobre eso es criptograficamente valida y semanticamente hueca:
// atesta el vacio. Reproducido en manga-translator-mvp antes de corregir sus
// superficies. Se rechaza en `--create` y en `--verify`.
const EMPTY_TREE_SHA256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

export function isEmptySubjectTree(treeHash) {
  return !treeHash || treeHash === EMPTY_TREE_SHA256;
}

// `%GS` NO tiene el mismo formato en GPG y en SSH, y la igualdad exacta contra
// un valor declarado a mano es la causa mas probable de que una firma legitima
// se rechace:
//  - GPG devuelve el UID completo, "Nombre Apellido <email>".
//  - SSH devuelve el PRINCIPAL de `allowed_signers`, normalmente solo el email,
//    un token sin espacios.
// Un consumidor que declaro "Nombre <email>" con `gpg.format=ssh` no podia
// pasar nunca; costo un commit de bootstrap averiguarlo empiricamente. Se
// acepta cualquiera de las dos formas comparando tambien el email extraido.
function extractEmail(value) {
  const angle = /<([^>]+)>/.exec(value);
  if (angle) return angle[1].trim().toLowerCase();
  const bare = value.trim();
  return /^[^\s<>@]+@[^\s<>@]+$/.test(bare) ? bare.toLowerCase() : null;
}

export function signerMatches(declared, observed) {
  const left = String(declared ?? "").trim();
  const right = String(observed ?? "").trim();
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.toLowerCase() === right.toLowerCase()) return true;
  const leftEmail = extractEmail(left);
  const rightEmail = extractEmail(right);
  return Boolean(leftEmail && rightEmail && leftEmail === rightEmail);
}

// Emparejar por HUELLA, que es lo unico que identifica una CLAVE.
//
// Por que hace falta ademas de `signerMatches`: con SSH, `%GS` es el principal
// de `allowed_signers`, y ese archivo ya ata identidad a clave. Con GPG no hay
// nada equivalente — `%GS` es el UID que la propia clave declara —, asi que
// cualquiera puede generar una clave con UID `maintainer@example.com`, meterla
// en su keyring y firmar: `verify-commit` la da por buena (`%G?` = U con el
// trust por defecto) y el email coincide. Autorizar por email NO autoriza una
// clave.
//
// `fingerprint` en el maintainer cierra eso. Se compara contra `%GF` (la clave
// que firmo) y `%GP` (su clave primaria), sin distinguir mayusculas ni el
// prefijo `SHA256:` que usa SSH.
function normalizeFingerprint(value) {
  return String(value ?? "").trim().replace(/^SHA256:/i, "").replace(/\s+/g, "").toLowerCase();
}

export function fingerprintMatches(declared, signingKey, primaryKey) {
  const wanted = normalizeFingerprint(declared);
  if (!wanted) return false;
  return [signingKey, primaryKey].map(normalizeFingerprint).some((actual) => actual && actual === wanted);
}

/**
 * @param {object} input
 * @param {string} input.target
 * @param {string} input.commitSha    El commit que se presenta como la firma.
 * @param {object} input.subject      Lo mismo que se le pidio aprobar, ej. { slice, phase, tree_hash }.
 * @param {Array}  input.maintainers  [{ signer: "..." }, ...] — ver governance.maintainers en config.
 *                                    Con GPG el valor es el UID ("Nombre <email>"); con
 *                                    `gpg.format=ssh` es el principal de `allowed_signers`
 *                                    (normalmente el email solo). Se aceptan ambas formas.
 * @param {string} [input.headRef]    Contra que rama debe ser antepasado el commit. Default HEAD.
 * @param {string} [input.currentTreeHash] Arbol de las superficies en `headRef`. Si se pasa y
 *                                    difiere del aprobado, la firma sigue siendo VALIDA pero se
 *                                    reporta `fresh: false`: quien llama decide si eso basta.
 */
// ---------------------------------------------------------------------------
// La verificacion se parte en dos: RECOGER los hechos de git (habla con el
// mundo) y JUZGARLOS (funcion pura). El motivo no es estetico: la auditoria
// necesita verificar muchas atestaciones a la vez, y con `spawnSync` un pool de
// concurrencia no concurre nada — bloquea el hilo. Con la recogida separada hay
// dos versiones, sincrona y asincrona, que comparten EXACTAMENTE el mismo
// juicio. Duplicar la logica de decision seria la forma segura de que las dos
// se separen sin que nadie lo note.
// ---------------------------------------------------------------------------

const COMMIT_FACTS_FORMAT = "--format=%G?%x00%GS%x00%GF%x00%GP%x00%B";

function precheckSignoff({ commitSha, subject }) {
  if (!commitSha) {
    return { ok: false, code: "signoff-commit-missing", detail: "no se declaro que commit firma la aprobacion" };
  }
  if (isEmptySubjectTree(subject?.tree_hash)) {
    return {
      ok: false,
      code: "signoff-empty-subject",
      detail:
        "el arbol de las superficies declaradas esta vacio: ninguna resuelve a archivos. " +
        "Verificar una firma contra el vacio la daria por buena sin que atestara nada. " +
        "Revisar `surfaces` en quality-contract.yaml."
    };
  }
  return null;
}

// `merge-base --is-ancestor` PRIMERO: si pasa, ya probo que el objeto resuelve
// a un commit y que esta en la historia, asi que `cat-file -e` sobra. Solo
// cuando falla hace falta distinguir "no existe" de "existe pero no es
// antepasado". Ahorra un spawn —unos 60 ms— en toda atestacion valida.
function collectSignoffFacts(target, commitSha, headRef) {
  const ancestry = git(["merge-base", "--is-ancestor", commitSha, headRef], target);
  if (!ancestry.ok) {
    return { ancestor: false, exists: git(["cat-file", "-e", commitSha], target).ok };
  }
  const verify = git(["verify-commit", commitSha], target);
  return {
    ancestor: true,
    exists: true,
    verifyOk: verify.ok,
    verifyStderr: verify.stderr,
    log: verify.ok ? git(["log", "-1", COMMIT_FACTS_FORMAT, commitSha], target).stdout : ""
  };
}

async function collectSignoffFactsAsync(target, commitSha, headRef) {
  const ancestry = await gitAsync(["merge-base", "--is-ancestor", commitSha, headRef], target);
  if (!ancestry.ok) {
    return { ancestor: false, exists: (await gitAsync(["cat-file", "-e", commitSha], target)).ok };
  }
  const verify = await gitAsync(["verify-commit", commitSha], target);
  return {
    ancestor: true,
    exists: true,
    verifyOk: verify.ok,
    verifyStderr: verify.stderr,
    log: verify.ok ? (await gitAsync(["log", "-1", COMMIT_FACTS_FORMAT, commitSha], target)).stdout : ""
  };
}

/** Funcion PURA: no habla con git. Todo lo que decide sale de `facts`. */
export function judgeSignoff({ facts, commitSha, subject, maintainers = [], headRef = "HEAD", currentTreeHash = null }) {
  if (!facts.ancestor) {
    if (!facts.exists) {
      return { ok: false, code: "signoff-commit-not-found", detail: `no existe el commit ${commitSha}` };
    }
    return {
      ok: false,
      code: "signoff-not-ancestor",
      detail: `${commitSha} no es antepasado de ${headRef}: la firma no forma parte de esta historia`
    };
  }

  if (!facts.verifyOk) {
    return { ok: false, code: "signoff-signature-invalid", detail: facts.verifyStderr || "git verify-commit rechazo la firma" };
  }

  // Validez, firmante, huella de la clave, huella primaria y mensaje, en UNA
  // sola invocacion. Eran tres llamadas separadas, y cada proceso de git cuesta
  // unos 60 ms en Windows. El separador NUL no puede aparecer en ninguno de los
  // campos, y `%B` va ultimo porque es el unico multilinea.
  const commitFacts = String(facts.log ?? "").split("\0");
  const validity = (commitFacts[0] ?? "").trim();
  if (validity !== "G" && validity !== "U") {
    return { ok: false, code: "signoff-signature-not-good", detail: `git reporta validez '${validity}', no 'G' ni 'U'` };
  }

  const signer = (commitFacts[1] ?? "").trim();
  const signingKey = (commitFacts[2] ?? "").trim();
  const primaryKey = (commitFacts[3] ?? "").trim();

  // Si el maintainer declara huella, MANDA la huella: es lo unico que identifica
  // la clave. El nombre/principal solo se acepta cuando no hay huella declarada,
  // y en ese caso la union queda marcada como debil para que se vea.
  const byFingerprint = maintainers.find((maintainer) => fingerprintMatches(maintainer.fingerprint, signingKey, primaryKey));
  const byPrincipal = maintainers.find((maintainer) => !maintainer.fingerprint && signerMatches(maintainer.signer, signer));
  if (!byFingerprint && !byPrincipal) {
    const declared = maintainers.map((maintainer) => `'${maintainer.signer}'`).join(", ") || "(lista vacia)";
    return {
      ok: false,
      code: "signoff-signer-not-maintainer",
      detail:
        `git reporta como firmante '${signer}' y governance.maintainers declara ${declared}. ` +
        `Declarar exactamente '${signer}' en config.governance.maintainers[].signer.`,
      signer
    };
  }

  const message = (commitFacts[4] ?? "").trim();
  const parsed = parseAttestationMessage(message);
  if (!parsed) {
    return { ok: false, code: "signoff-message-invalid", detail: `el commit no trae el trailer ${ATTESTATION_TRAILER}` };
  }

  const expected = computeSubjectSha256(subject);
  if (parsed.subjectSha256 !== expected) {
    // Antes de dar un `mismatch` generico se comprueba si la firma es una v1:
    // el sujeto se RECOMPUTA, nunca se lee del commit, asi que la unica forma
    // de saber con que version se firmo es recomputar tambien la anterior y ver
    // cual casa. Sin esto, una atestacion legitima de 1.x se reportaba igual
    // que una manipulada, y la accion a tomar es completamente distinta:
    // re-firmar contra investigar.
    const v1 = subjectV1(subject);
    if (v1 && computeSubjectSha256(v1) === parsed.subjectSha256) {
      return {
        ok: false,
        code: "signoff-subject-v1",
        detail:
          "la atestacion se firmo con el sujeto v1 `{slice, phase, tree_hash}`, sin `contract_sha256`: no cubre la politica bajo la que se emitio. Volver a firmar con `sdlc signoff --slice <id> --phase <F> --create --record`"
      };
    }
    return {
      ok: false,
      code: "signoff-subject-mismatch",
      detail: `la firma aprueba ${parsed.subjectSha256.slice(0, 12)}, pero lo que hay que aprobar ahora es ${expected.slice(0, 12)}`
    };
  }

  // Frescura: eje SEPARADO de la validez. La firma aprobo un arbol concreto y
  // eso no caduca; que el arbol se haya movido despues es otra pregunta, y la
  // responde quien llama segun la fase.
  const fresh = currentTreeHash === null ? null : currentTreeHash === subject.tree_hash;

  // `identityBinding` dice CON QUE se autorizo: `fingerprint` ata a una clave;
  // `principal` ata a un nombre que la propia clave declara, y con GPG eso lo
  // puede fabricar cualquiera.
  return {
    ok: true,
    code: null,
    signer,
    signingKey: signingKey || null,
    identityBinding: byFingerprint ? "fingerprint" : "principal",
    commitSha,
    subjectSha256: expected,
    fresh,
    currentTreeHash
  };
}

export function verifySignoff({ target, commitSha, subject, maintainers = [], headRef = "HEAD", currentTreeHash = null }) {
  const pre = precheckSignoff({ commitSha, subject });
  if (pre) return pre;
  const facts = collectSignoffFacts(target, commitSha, headRef);
  return judgeSignoff({ facts, commitSha, subject, maintainers, headRef, currentTreeHash });
}

/** Misma verificacion sin bloquear el hilo: es la que usa el pool de la auditoria. */
export async function verifySignoffAsync({ target, commitSha, subject, maintainers = [], headRef = "HEAD", currentTreeHash = null }) {
  const pre = precheckSignoff({ commitSha, subject });
  if (pre) return pre;
  const facts = await collectSignoffFactsAsync(target, commitSha, headRef);
  return judgeSignoff({ facts, commitSha, subject, maintainers, headRef, currentTreeHash });
}

/**
 * Helper LOCAL para crear el commit de aprobacion. Nunca es autoritativo por
 * si mismo — lo autoritativo es que el commit resultante pase verifySignoff
 * en CI, igual que cualquier otra evidencia de este gauntlet.
 */

/**
 * ¿Hay cambios sin commitear dentro de las superficies?
 *
 * Se expone aparte porque el orden de los mensajes importa: con el arbol sucio,
 * el contrato tampoco esta commiteado todavia, asi que armar el sujeto falla
 * con `contract-missing-at-ref` y esconde la causa real. Quien tiene que
 * commitear no necesita enterarse de dos cosas: necesita enterarse de la
 * primera.
 */
export function worktreeDirtyForSurfaces(target, surfacePaths = []) {
  const scope = surfacePaths.length > 0 ? ["--", ...surfacePaths] : [];
  const dirty = git(["status", "--porcelain", ...scope], target);
  if (dirty.ok && dirty.stdout) {
    return {
      dirty: true,
      code: "signoff-worktree-dirty",
      detail: `hay cambios sin commitear en las superficies declaradas; el commit de atestacion es vacio y firmaria el arbol de HEAD, no lo que hay en disco:
${dirty.stdout}`
    };
  }
  return { dirty: false, code: null, detail: null };
}

export function createAttestationCommit({
  target,
  slice,
  phase,
  subject,
  signingKey = null,
  surfacePaths = [],
  allowDirty = false
}) {
  // El orden importa: el arbol tambien sale vacio cuando la superficie existe
  // pero nada de ella se ha commiteado todavia. Avisar primero de lo que no
  // esta commiteado da la accion correcta; si tras commitear sigue vacio, es
  // que la superficie es fantasma y salta la guarda siguiente.
  //
  // El commit de atestacion es vacio, asi que su arbol es el de HEAD: si hay
  // cambios sin commitear dentro de las superficies, lo que se firmaria NO es
  // lo que el humano tiene delante. Se bloquea, con la lista exacta de lo que
  // estorba, en vez de firmar algo distinto de lo revisado.
  if (!allowDirty) {
    const scope = surfacePaths.length > 0 ? ["--", ...surfacePaths] : [];
    const dirty = git(["status", "--porcelain", ...scope], target);
    if (dirty.ok && dirty.stdout) {
      return {
        ok: false,
        code: "signoff-worktree-dirty",
        detail:
          "hay cambios sin commitear en las superficies a aprobar; el commit de atestacion es vacio y " +
          "firmaria el arbol de HEAD, no lo que hay en disco. Commitear primero, o repetir con --allow-dirty " +
          `si la diferencia es irrelevante:\n${dirty.stdout}`
      };
    }
  }

  if (isEmptySubjectTree(subject?.tree_hash)) {
    return {
      ok: false,
      code: "signoff-empty-subject",
      detail:
        "el arbol de las superficies declaradas esta vacio: firmar ahora seria atestar el vacio. " +
        "Corregir `surfaces` en quality-contract.yaml antes de aprobar nada."
    };
  }

  const subjectSha256 = computeSubjectSha256(subject);
  const message = buildAttestationMessage({ slice, phase, subjectSha256 });
  // `-S<keyid>` pegado solo vale para GPG. Con `gpg.format=ssh` la clave es una
  // ruta o un literal de clave publica, y esa forma falla; `-c user.signingkey`
  // funciona igual en los dos formatos.
  const configFlags = signingKey ? ["-c", `user.signingkey=${signingKey}`] : [];
  const result = git([...configFlags, "commit", "--allow-empty", "-S", "-m", message], target);
  if (!result.ok) {
    return { ok: false, code: "signoff-commit-failed", detail: result.stderr };
  }
  const commitSha = git(["rev-parse", "HEAD"], target).stdout;
  return { ok: true, commitSha, subjectSha256, message };
}
