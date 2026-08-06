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

/**
 * @param {object} input
 * @param {string} input.target
 * @param {string} input.commitSha    El commit que se presenta como la firma.
 * @param {object} input.subject      Lo mismo que se le pidio aprobar, ej. { slice, phase, tree_hash }.
 * @param {Array}  input.maintainers  [{ signer: "Nombre <email>" }, ...] — ver governance.maintainers en config.
 * @param {string} [input.headRef]    Contra que rama debe ser antepasado el commit. Default HEAD.
 */
export function verifySignoff({ target, commitSha, subject, maintainers = [], headRef = "HEAD" }) {
  if (!commitSha) {
    return { ok: false, code: "signoff-commit-missing", detail: "no se declaro que commit firma la aprobacion" };
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
  const allowed = maintainers.some((maintainer) => maintainer.signer === signer);
  if (!allowed) {
    return { ok: false, code: "signoff-signer-not-maintainer", detail: `'${signer}' firmo pero no esta en maintainers`, signer };
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

  return { ok: true, code: null, signer, commitSha, subjectSha256: expected };
}

/**
 * Helper LOCAL para crear el commit de aprobacion. Nunca es autoritativo por
 * si mismo — lo autoritativo es que el commit resultante pase verifySignoff
 * en CI, igual que cualquier otra evidencia de este gauntlet.
 */
export function createAttestationCommit({ target, slice, phase, subject, signingKey = null }) {
  const subjectSha256 = computeSubjectSha256(subject);
  const message = buildAttestationMessage({ slice, phase, subjectSha256 });
  const signFlag = signingKey ? `-S${signingKey}` : "-S";
  const result = git(["commit", "--allow-empty", signFlag, "-m", message], target);
  if (!result.ok) {
    return { ok: false, code: "signoff-commit-failed", detail: result.stderr };
  }
  const commitSha = git(["rev-parse", "HEAD"], target).stdout;
  return { ok: true, commitSha, subjectSha256, message };
}
