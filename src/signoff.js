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
import { sha256Text, stableJson } from "./file-utils.js";

export const ATTESTATION_TRAILER = "Signed-Attestation-Subject";

const TRAILER_PATTERN = new RegExp(`^${ATTESTATION_TRAILER}:\\s*([a-f0-9]{64})\\s*$`, "m");

// El sujeto es lo que el humano aprueba (tipicamente { slice, phase, tree_hash
// }): un objeto plano de valores primitivos, asi que stableJson alcanza sin
// necesitar un serializador recursivo propio.
export function computeSubjectSha256(subject) {
  return sha256Text(stableJson(subject));
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
export function verifySignoff({ target, commitSha, subject, maintainers = [], headRef = "HEAD", currentTreeHash = null }) {
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

  const exists = git(["cat-file", "-e", commitSha], target);
  if (!exists.ok) {
    return { ok: false, code: "signoff-commit-not-found", detail: `no existe el commit ${commitSha}` };
  }

  const ancestry = git(["merge-base", "--is-ancestor", commitSha, headRef], target);
  if (!ancestry.ok) {
    return {
      ok: false,
      code: "signoff-not-ancestor",
      detail: `${commitSha} no es antepasado de ${headRef}: la firma no forma parte de esta historia`
    };
  }

  const verify = git(["verify-commit", commitSha], target);
  if (!verify.ok) {
    return { ok: false, code: "signoff-signature-invalid", detail: verify.stderr || "git verify-commit rechazo la firma" };
  }

  // %G?: N sin firma, B mala, U buena pero de confianza no verificada, G
  // buena y de confianza total. Se acepta G y U: lo que importa aca es
  // identidad (el firmante esta en maintainers), no una cadena de confianza.
  const validity = git(["log", "-1", "--format=%G?", commitSha], target).stdout;
  if (validity !== "G" && validity !== "U") {
    return { ok: false, code: "signoff-signature-not-good", detail: `git reporta validez '${validity}', no 'G' ni 'U'` };
  }

  const signer = git(["log", "-1", "--format=%GS", commitSha], target).stdout;
  const allowed = maintainers.some((maintainer) => signerMatches(maintainer.signer, signer));
  if (!allowed) {
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

  const message = git(["log", "-1", "--format=%B", commitSha], target).stdout;
  const parsed = parseAttestationMessage(message);
  if (!parsed) {
    return { ok: false, code: "signoff-message-invalid", detail: `el commit no trae el trailer ${ATTESTATION_TRAILER}` };
  }

  const expected = computeSubjectSha256(subject);
  if (parsed.subjectSha256 !== expected) {
    return {
      ok: false,
      code: "signoff-subject-mismatch",
      detail: `la firma aprueba ${parsed.subjectSha256.slice(0, 12)}, pero lo que hay que aprobar ahora es ${expected.slice(0, 12)}`
    };
  }

  // Frescura: eje SEPARADO de la validez. La firma aprobo un arbol concreto y
  // eso no caduca; que el arbol se haya movido despues es otra pregunta, y la
  // responde quien llama segun la fase. Confundir las dos cosas es lo que hacia
  // que una atestacion dejara de verificarse al commit siguiente.
  const fresh = currentTreeHash === null ? null : currentTreeHash === subject.tree_hash;

  return { ok: true, code: null, signer, commitSha, subjectSha256: expected, fresh, currentTreeHash };
}

/**
 * Helper LOCAL para crear el commit de aprobacion. Nunca es autoritativo por
 * si mismo — lo autoritativo es que el commit resultante pase verifySignoff
 * en CI, igual que cualquier otra evidencia de este gauntlet.
 */
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
