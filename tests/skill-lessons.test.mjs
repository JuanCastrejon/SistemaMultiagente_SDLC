// ---------------------------------------------------------------------------
// Lecciones -> skills (ADR 025 del consumidor: skills vivas, loop SkillOpt).
//
// El ADR define COMO se edita una skill con disciplina. Faltaba el DISPARADOR:
// que pasa cuando aparece un error, un bloqueo o una tarea que ya se hizo tres
// veces. Aqui se prueba que ese incidente se captura, que repetirse SUMA en vez
// de duplicar (eso es la evidencia que justifica invertir en una skill), y
// sobre todo que promoverla NUNCA toca la skill canonica.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { recordLesson, listLessons, promoteLesson, rejectLesson, lessonFingerprint } from "../src/skill-lessons.js";

function freshTarget() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-lesson-"));
}

// --- una leccion sin 'correction' no es una leccion -------------------------
{
  const target = freshTarget();
  const incompleta = recordLesson(target, { type: "error", title: "algo fallo" });
  assert.equal(incompleta.ok, false);
  assert.equal(incompleta.code, "lesson-correction-missing", "sin decir que hacer la proxima vez es una queja, no una leccion");

  assert.equal(recordLesson(target, { type: "inventado", title: "x", correction: "y" }).code, "lesson-type-invalid");
  assert.equal(recordLesson(target, { type: "error", title: "", correction: "y" }).code, "lesson-title-missing");
}

console.log("skill-lessons validacion de entrada: PASS");

// --- repetirse SUMA, no duplica --------------------------------------------
// Sin esto el ledger se llena de entradas y "paso tres veces" se ve igual que
// "pasaron tres cosas distintas", que es justo la senal que hay que medir.
{
  const target = freshTarget();
  const args = { type: "error", title: "npm link rompe el arbitro", correction: "usar devDependency versionada" };
  const first = recordLesson(target, args);
  assert.equal(first.ok, true);
  assert.equal(first.repeated, false);
  assert.equal(first.lesson.occurrences, 1);
  assert.equal(first.lesson.needsNewSkill, true, "sin --skill, el caso exige una skill NUEVA (skill-propose solo actualiza existentes)");

  const second = recordLesson(target, args);
  assert.equal(second.repeated, true);
  assert.equal(second.lesson.occurrences, 2);
  assert.equal(second.lesson.id, first.lesson.id, "el mismo incidente es la misma leccion, no una nueva");

  // Distinto titulo = distinto incidente.
  const otra = recordLesson(target, { ...args, title: "otro problema" });
  assert.notEqual(otra.lesson.id, first.lesson.id);

  // La huella no depende de mayusculas ni de espacios de mas.
  assert.equal(
    lessonFingerprint({ type: "error", skill: null, title: "Un   Titulo" }),
    lessonFingerprint({ type: "error", skill: null, title: "un titulo" })
  );
}

console.log("skill-lessons acumulacion: PASS");

// --- el umbral separa incidente de patron -----------------------------------
{
  const target = freshTarget();
  const args = { type: "blocker", title: "el gate bloquea sin decir por que", correction: "incluir el motivo en el payload" };
  const created = recordLesson(target, args);

  const antes = promoteLesson(target, created.lesson.id, { change: "demo" });
  assert.equal(antes.ok, false);
  assert.equal(antes.code, "lesson-below-threshold", "una sola vez es un incidente: promoverlo seria decidir por intuicion");

  // `--force` existe, pero deja el salto explicito en vez de silencioso.
  const forzado = promoteLesson(target, created.lesson.id, { change: "demo-forzado", force: true });
  assert.equal(forzado.ok, true);

  const listed = listLessons(target);
  assert.equal(listed.ready.length + listed.watching.length, 0, "ya promovida, sale de las abiertas");
  assert.equal(listed.promoted.length, 1);
}

console.log("skill-lessons umbral: PASS");

// --- RESTRICCION 1 DEL ADR 025: jamas se toca la skill canonica -------------
{
  const target = freshTarget();
  // Skill canonica preexistente, con contenido que debe quedar intacto.
  const canonicalDir = path.join(target, ".github", "skills", "commit");
  fs.mkdirSync(canonicalDir, { recursive: true });
  const canonicalPath = path.join(canonicalDir, "SKILL.md");
  fs.writeFileSync(canonicalPath, "# commit\ncontenido original\n", "utf8");
  const antes = fs.readFileSync(canonicalPath, "utf8");

  const args = { type: "repetition", title: "se olvida el co-author", correction: "incluir la linea Co-Authored-By", skill: "commit" };
  recordLesson(target, args);
  const repetida = recordLesson(target, args);
  assert.equal(repetida.lesson.occurrences, 2);
  assert.equal(repetida.lesson.needsNewSkill, false, "con --skill apunta a una existente");

  const promoted = promoteLesson(target, repetida.lesson.id, { change: "mejora-commit" });
  assert.equal(promoted.ok, true);
  assert.match(promoted.proposal, /^openspec\/changes\/mejora-commit\//, "la propuesta vive bajo openspec/changes/");

  assert.equal(
    fs.readFileSync(canonicalPath, "utf8"),
    antes,
    "promover una leccion NO puede mutar la skill canonica: es la restriccion 1 del ADR 025"
  );

  const body = fs.readFileSync(path.join(target, promoted.proposal), "utf8");
  assert.match(body, /2/, "la propuesta debe llevar la evidencia: cuantas veces paso");
  assert.match(body, /Co-Authored-By/, "y que deberia hacerse la proxima vez");
  assert.match(body, /skill-propose --skill commit/, "para una skill existente, enruta al comando gated que ya existe");
}

// TRAVERSAL: el caso benigno no demuestra contencion.
// `path.join` resuelve `..`, asi que `--change ../../.github/skills/commit`
// escribia DENTRO del directorio canonico — la misma restriccion que el bloque
// de arriba dice verificar, rota por la ruta que ese bloque no probaba.
// Reproducido antes del fix.
{
  const target = freshTarget();
  const canonicalDir = path.join(target, ".github", "skills", "commit");
  fs.mkdirSync(canonicalDir, { recursive: true });
  fs.writeFileSync(path.join(canonicalDir, "SKILL.md"), "# commit\nORIGINAL\n", "utf8");

  const args = { type: "error", title: "traversal", correction: "contener la ruta" };
  recordLesson(target, args);
  const repetida = recordLesson(target, args);

  for (const evil of ["../../.github/skills/commit", "..", "../../..", "sub/../../../escape"]) {
    const result = promoteLesson(target, repetida.lesson.id, { change: evil });
    assert.equal(result.ok, false, `'${evil}' resuelve fuera de openspec/changes y debe rechazarse`);
    assert.equal(result.code, "change-outside-changes-dir");
  }
  assert.deepEqual(
    fs.readdirSync(canonicalDir),
    ["SKILL.md"],
    "ningun intento pudo dejar un archivo en el directorio canonico"
  );

  // Contracara: un slug normal, y uno anidado legitimo, siguen funcionando.
  assert.equal(promoteLesson(target, repetida.lesson.id, { change: "slug-normal" }).ok, true);
}

// El umbral no puede desactivarse pasando 0 o negativo, y forzar deja rastro.
{
  const target = freshTarget();
  const created = recordLesson(target, { type: "error", title: "una sola vez", correction: "z" });

  for (const bogus of [0, -5, Number.NaN]) {
    const result = promoteLesson(target, created.lesson.id, { change: "demo", threshold: bogus });
    assert.equal(result.ok, false, `threshold ${bogus} no puede desactivar la evidencia`);
    assert.equal(result.code, "lesson-below-threshold");
  }

  const forced = promoteLesson(target, created.lesson.id, { change: "demo", force: true });
  assert.equal(forced.ok, true);
  assert.ok(forced.lesson.forcedPromotion, "forzar tiene que quedar registrado: 'fue explicito' no sirve si no se escribe");
  assert.equal(forced.lesson.forcedPromotion.occurrences, 1);
}

console.log("skill-lessons no muta lo canonico: PASS");

// --- ledger de rechazos: memoria de los "no" --------------------------------
{
  const target = freshTarget();
  const created = recordLesson(target, { type: "error", title: "x", correction: "y" });

  assert.equal(rejectLesson(target, created.lesson.id, {}).code, "reason-missing", "un 'no' sin motivo se re-discute cada ciclo");

  const rejected = rejectLesson(target, created.lesson.id, { reason: "ya lo cubre la skill de commit" });
  assert.equal(rejected.ok, true);
  assert.equal(rejected.lesson.status, "rejected");
  assert.ok(rejected.lesson.rejectedReason);

  // Y no re-emerge: volver a registrarlo crea una entrada nueva en vez de
  // resucitar la rechazada, para que el "no" quede en el historial.
  const listed = listLessons(target);
  assert.equal(listed.rejected.length, 1);
  assert.equal(listed.ready.length + listed.watching.length, 0);
}

console.log("skill-lessons ledger de rechazos: PASS");
