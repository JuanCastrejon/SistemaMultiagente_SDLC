// ---------------------------------------------------------------------------
// Lecciones que se convierten en skills (ADR 025 del consumidor: skills vivas,
// loop estilo SkillOpt gated)
//
// El ADR 025 define COMO se edita una skill con disciplina (rollout, score,
// gate humano, ledger de rechazos). Lo que no existia es el DISPARADOR: que
// pasa cuando en medio del trabajo aparece un error, un bloqueo o una tarea
// que ya se hizo tres veces. Hoy ese conocimiento se pierde en el chat, y el
// siguiente agente vuelve a tropezar con la misma piedra.
//
// Una leccion es EVIDENCIA de que hace falta una skill, no la skill. Y la
// evidencia se acumula: la segunda vez que aparece el mismo incidente, el
// contador sube. Eso convierte "creo que aqui falta una skill" en un numero
// —cuantas veces paso— que es exactamente la disciplina que el ADR pide para
// el score: aprobar contra evidencia, no contra intuicion.
//
// LIMITES QUE VIENEN DEL ADR 025, y que aqui no se negocian:
//   - Una leccion NUNCA toca `.github/skills/` ni sus mirrors. Promoverla
//     escribe una propuesta bajo `openspec/changes/<change>/` y nada mas.
//   - El gate humano queda en serie: `promote` prepara la propuesta, no la
//     aprueba. Aprobar sigue siendo un acto de una persona.
//   - Una leccion rechazada se conserva con su motivo. Es el ledger de
//     rechazos del ADR: memoria de los "no", para que la misma idea no
//     re-emerja cada ciclo como si fuera nueva.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { ensureDir, pathExists, sha256Text } from "./file-utils.js";

const LEDGER_RELATIVE = path.join(".github", "agent-state", "lessons.yaml");

export const LESSON_TYPES = new Set(["error", "blocker", "repetition"]);

// Cuantas apariciones hacen que una leccion valga una skill. Dos: la primera
// vez es un incidente, la segunda ya es un patron. Configurable por si un
// consumidor quiere ser mas estricto.
export const DEFAULT_PROMOTION_THRESHOLD = 2;

export function ledgerPath(target) {
  return path.join(target, LEDGER_RELATIVE);
}

/**
 * Normaliza el incidente a una huella estable. Si el mismo problema vuelve a
 * pasar, la huella coincide y sube el contador en vez de crear una entrada
 * nueva: sin esto el ledger se llena de duplicados y "paso tres veces" se ve
 * igual que "pasaron tres cosas distintas".
 */
export function lessonFingerprint({ type, skill, title }) {
  const normalized = [String(type ?? "").trim().toLowerCase(), String(skill ?? "").trim().toLowerCase(), String(title ?? "").trim().toLowerCase().replace(/\s+/g, " ")].join("|");
  return sha256Text(normalized);
}

export function loadLessons(target) {
  const absolute = ledgerPath(target);
  if (!pathExists(absolute)) return { ok: true, path: absolute, version: 1, lessons: [] };
  try {
    const parsed = YAML.parse(fs.readFileSync(absolute, "utf8")) ?? {};
    return { ok: true, path: absolute, version: parsed.version ?? 1, lessons: Array.isArray(parsed.lessons) ? parsed.lessons : [] };
  } catch (error) {
    return { ok: false, code: "lessons-unparseable", path: absolute, detail: error.message, lessons: [] };
  }
}

function writeLessons(target, lessons) {
  const absolute = ledgerPath(target);
  ensureDir(path.dirname(absolute));
  fs.writeFileSync(absolute, YAML.stringify({ version: 1, lessons }), "utf8");
  return absolute;
}

/**
 * Registra un incidente. `correction` es lo que importa de verdad: sin decir
 * QUE habria que hacer la proxima vez, la leccion es una queja, no una
 * leccion — y una skill generada desde ahi no le sirve a nadie.
 */
export function recordLesson(target, { type, title, detail = null, correction = null, skill = null, at = null } = {}) {
  if (!LESSON_TYPES.has(type)) {
    return { ok: false, code: "lesson-type-invalid", detail: `type debe ser uno de: ${[...LESSON_TYPES].join(", ")}` };
  }
  if (!title || !String(title).trim()) {
    return { ok: false, code: "lesson-title-missing", detail: "una leccion sin titulo no se puede reconocer cuando vuelva a pasar" };
  }
  if (!correction || !String(correction).trim()) {
    return {
      ok: false,
      code: "lesson-correction-missing",
      detail: "falta 'correction': que deberia hacerse la proxima vez. Sin eso es un reporte de incidente, no una leccion que pueda volverse skill"
    };
  }

  const loaded = loadLessons(target);
  if (!loaded.ok) return loaded;

  const fingerprint = lessonFingerprint({ type, skill, title });
  const timestamp = at ?? new Date().toISOString();
  const existing = loaded.lessons.find((lesson) => lesson.fingerprint === fingerprint && lesson.status !== "rejected");

  if (existing) {
    // Reaparecio. Sube el contador en vez de duplicar: eso es la senal de
    // "actividad repetitiva" que justifica invertir en una skill.
    existing.occurrences = (existing.occurrences ?? 1) + 1;
    existing.lastSeen = timestamp;
    if (detail) existing.detail = detail;
    if (correction) existing.correction = correction;
    writeLessons(target, loaded.lessons);
    return { ok: true, lesson: existing, repeated: true, path: loaded.path };
  }

  const lesson = {
    id: `ls-${fingerprint.slice(0, 8)}`,
    fingerprint,
    type,
    title: String(title).trim(),
    detail: detail ?? null,
    correction: String(correction).trim(),
    skill: skill ?? null,
    // `skill: null` significa que no hay skill donde meter esto: hace falta una
    // NUEVA. `skill-propose` solo sabe actualizar existentes, asi que este es
    // el caso que antes no tenia camino.
    needsNewSkill: !skill,
    occurrences: 1,
    firstSeen: timestamp,
    lastSeen: timestamp,
    status: "open",
    promotedTo: null
  };
  loaded.lessons.push(lesson);
  writeLessons(target, loaded.lessons);
  return { ok: true, lesson, repeated: false, path: loaded.path };
}

/**
 * Lecciones abiertas, marcando cuales ya tienen evidencia suficiente. Que el
 * umbral sea explicito evita la discusion subjetiva: o paso N veces o no.
 */
export function listLessons(target, { threshold = DEFAULT_PROMOTION_THRESHOLD } = {}) {
  const loaded = loadLessons(target);
  if (!loaded.ok) return loaded;
  const open = loaded.lessons.filter((lesson) => lesson.status === "open");
  return {
    ok: true,
    path: loaded.path,
    threshold,
    ready: open.filter((lesson) => (lesson.occurrences ?? 1) >= threshold),
    watching: open.filter((lesson) => (lesson.occurrences ?? 1) < threshold),
    promoted: loaded.lessons.filter((lesson) => lesson.status === "promoted"),
    rejected: loaded.lessons.filter((lesson) => lesson.status === "rejected")
  };
}

/**
 * Prepara la propuesta bajo `openspec/changes/<change>/`. NUNCA escribe en
 * `.github/skills/`: esa es la restriccion 1 del ADR 025 y es lo que mantiene
 * al optimizador fuera de las fuentes canonicas.
 */
export function promoteLesson(target, lessonId, { change, threshold = DEFAULT_PROMOTION_THRESHOLD, force = false } = {}) {
  if (!change) return { ok: false, code: "change-missing", detail: "promover exige --change <slug>: la propuesta vive en openspec/changes/<slug>/" };
  const loaded = loadLessons(target);
  if (!loaded.ok) return loaded;

  const lesson = loaded.lessons.find((entry) => entry.id === lessonId);
  if (!lesson) return { ok: false, code: "lesson-unknown", detail: `no existe la leccion '${lessonId}'` };
  if (lesson.status !== "open") return { ok: false, code: "lesson-not-open", detail: `la leccion esta en estado '${lesson.status}'` };

  // Un umbral que el invocador puede poner en 0 no es un umbral. `Number()`
  // aceptaba 0 y negativos, con lo que se saltaba la evidencia sin `--force`
  // y sin dejar rastro.
  const effectiveThreshold = Number.isFinite(threshold) && threshold >= 1 ? Math.floor(threshold) : DEFAULT_PROMOTION_THRESHOLD;
  const occurrences = lesson.occurrences ?? 1;
  if (occurrences < effectiveThreshold && !force) {
    return {
      ok: false,
      code: "lesson-below-threshold",
      detail: `la leccion aparecio ${occurrences} vez/veces y el umbral es ${effectiveThreshold}: todavia es un incidente, no un patron. Usar --force para promover igual y dejarlo explicito`,
      occurrences,
      threshold: effectiveThreshold
    };
  }

  // CONTENCION. `path.join` resuelve `..`, asi que `--change
  // ../../.github/skills/commit` escribia DENTRO del directorio canonico de
  // skills — precisamente la restriccion 1 del ADR 025 que esta funcion dice
  // respetar. Reproducido antes del fix. Que la ruta "normalmente" caiga en
  // openspec/changes/ no es contencion; contencion es comprobarlo.
  const changesRoot = path.resolve(target, "openspec", "changes");
  const changeDir = path.resolve(changesRoot, change);
  if (changeDir !== changesRoot && !changeDir.startsWith(changesRoot + path.sep)) {
    return {
      ok: false,
      code: "change-outside-changes-dir",
      detail: `'${change}' resuelve fuera de openspec/changes/. Una propuesta solo puede escribirse ahi (ADR 025, restriccion 1)`
    };
  }
  ensureDir(changeDir);
  const proposalPath = path.join(changeDir, `skill-lesson-${lesson.id}.md`);

  const body = [
    `# Propuesta de skill desde leccion \`${lesson.id}\``,
    "",
    "> Generado por `sdlc skill-lesson --promote`. Es una PROPUESTA: no toca",
    "> `.github/skills/` ni sus mirrors (ADR 025, restriccion 1). La aprobacion",
    "> sigue siendo un acto humano contra la evidencia de abajo.",
    "",
    "## Evidencia",
    "",
    `- Tipo: **${lesson.type}**`,
    `- Veces que ocurrio: **${occurrences}** (umbral: ${threshold})`,
    `- Primera vez: ${lesson.firstSeen}`,
    `- Ultima vez: ${lesson.lastSeen}`,
    "",
    "## Que paso",
    "",
    lesson.title,
    "",
    ...(lesson.detail ? [lesson.detail, ""] : []),
    "## Que deberia hacerse la proxima vez",
    "",
    lesson.correction,
    "",
    "## Destino",
    "",
    lesson.skill
      ? `Actualizar la skill existente \`${lesson.skill}\`. Continuar con:\n\n\`\`\`\nsdlc skill-propose --skill ${lesson.skill} --change ${change} --intent "${lesson.correction.replace(/"/g, "'")}"\n\`\`\``
      : "**Hace falta una skill nueva**: ninguna existente cubre este caso. Definir su nombre y alcance antes de escribirla, y recordar que `skill-propose` solo sabe actualizar skills que ya existen.",
    ""
  ].join("\n");

  fs.writeFileSync(proposalPath, body, "utf8");
  lesson.status = "promoted";
  lesson.promotedTo = change;
  // Forzar deja rastro: "fue explicito" no sirve si no queda escrito.
  if (occurrences < effectiveThreshold) {
    lesson.forcedPromotion = { occurrences, threshold: effectiveThreshold, at: new Date().toISOString() };
  }
  writeLessons(target, loaded.lessons);

  return { ok: true, lesson, proposal: path.relative(target, proposalPath).split(path.sep).join("/"), change };
}

/**
 * Rechaza con motivo. El ADR 025 lo pide explicitamente: una edicion rechazada
 * queda como anti-patron para que no re-emerja en ciclos futuros. Un "no" sin
 * motivo se re-discute cada vez.
 */
export function rejectLesson(target, lessonId, { reason } = {}) {
  if (!reason || !String(reason).trim()) {
    return { ok: false, code: "reason-missing", detail: "rechazar exige --reason: un 'no' sin motivo se vuelve a discutir en el proximo ciclo" };
  }
  const loaded = loadLessons(target);
  if (!loaded.ok) return loaded;
  const lesson = loaded.lessons.find((entry) => entry.id === lessonId);
  if (!lesson) return { ok: false, code: "lesson-unknown", detail: `no existe la leccion '${lessonId}'` };

  lesson.status = "rejected";
  lesson.rejectedReason = String(reason).trim();
  lesson.rejectedAt = new Date().toISOString();
  writeLessons(target, loaded.lessons);
  return { ok: true, lesson };
}
