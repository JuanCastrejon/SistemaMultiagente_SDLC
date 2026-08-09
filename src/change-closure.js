// ---------------------------------------------------------------------------
// Cierre de change por HECHOS, no por checkbox (ADR 0007, P11)
//
// Evidencia real del repo padre: un change se archivo con 8 tareas SIN
// marcar en tasks.md, incluida literalmente "T6.3 — Merge a develop", que ya
// habia ocurrido. El ledger (el checkbox) y la realidad (el estado de git)
// divergieron y nada lo detecto. Las tareas de firma humana (qa-security-
// review, lead-testing-qa-review) se marcaron [x] OCHO DIAS despues del
// merge: firma retroactiva en una ruta de auditoria de pagos.
//
// Este modulo verifica TRES cosas antes de permitir el cierre de un change:
// 1. Ninguna tarea en tasks.md puede quedar sin marcar. Un checkbox vacio no
//    es "pendiente aceptable" en un change que se cierra: es trabajo que el
//    change dice haber hecho y no hizo.
// 2. Una tarea que declara un merge a la rama de integracion solo puede
//    marcarse [x] si ese merge YA ES CIERTO en git. Marcar la casilla no
//    hace que el merge exista.
// 3. Toda fase con gate humano (F13/F14 por defecto) tiene que mostrar su
//    PROPIA evidencia en `ok`. Un checkbox de tasks.md diciendo "review
//    hecho" no es lo mismo que el review exista de verdad -- eso ya lo sabe
//    verificar `evaluatePhaseReadiness` (harness.js); esto solo lo cruza
//    contra el cierre en vez de reinventarlo.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { evaluatePhaseReadiness } from "./harness.js";
import { detectCiEnvironment } from "./ci-detect.js";

// Bullet `-`, `*` o `+`, o lista numerada (`1.`, `2)`), y cualquier marca de
// un caracter dentro de los corchetes. El patron original solo aceptaba
// `[ ]`/`[x]` con bullet `-`/`*`, asi que seis de siete formas habituales de
// escribir una tarea pendiente quedaban INVISIBLES: `[-]`, `[~]`, `[/]`
// (convenciones de "en curso" o "cancelada" en Obsidian y varios editores),
// listas numeradas y bullets `+`. Una tarea invisible no es una tarea
// cumplida, pero el cierre las contaba como si no existieran.
const CHECKBOX_PATTERN = /^(?:[-*+]|\d+[.)])\s+\[(.)\]\s+(.+)$/;
// Solo `x`/`X` cuenta como hecha. Cualquier otra marca (espacio, `-`, `~`,
// `/`) es trabajo declarado que no esta terminado.
const DONE_MARKS = new Set(["x", "X"]);
// El texto de la tarea lo escribe un humano o un agente, no un id
// estructurado: el patron es deliberadamente amplio. Cubre tambien las formas
// que evitan la palabra "merge" (integrar, PR, subir a <rama>), porque el
// chequeo no puede depender de como redacte la tarea quien la escribe.
const MERGE_TASK_PATTERN = /\bmerge\b|\bmezcla\b|\bfusion(ar)?\b|\bintegrar\b|\bintegracion\b|\bPR\b|\bsubir\b|\bpush\b/i;

export function parseTasksFile(raw) {
  const lines = String(raw ?? "").split(/\r?\n/);
  const tasks = [];
  lines.forEach((line, index) => {
    const match = CHECKBOX_PATTERN.exec(line.trim());
    if (!match) return;
    tasks.push({ checked: DONE_MARKS.has(match[1]), mark: match[1], title: match[2].trim(), line: index + 1 });
  });
  return tasks;
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim(), stderr: result.stderr ?? "" };
}

// Rama de integracion resoluble.
//
// El comentario anterior afirmaba que la ref remota "no se puede reescribir
// localmente para simular un merge que no paso". Es FALSO y la auditoria lo
// reprodujo: `git update-ref refs/remotes/origin/develop HEAD` la forja sin
// red y sin remoto configurado. Peor, el codigo PREFERIA esa ref forjable
// sobre la rama local, o sea que la forma mas facil de mentir ganaba.
//
// No hay forma de distinguir localmente una ref remota legitima de una
// forjada — el unico testigo real es el runner de CI, que hace fetch de
// verdad. Asi que en vez de fingir una garantia que no existe: se devuelven
// AMBAS refs cuando difieren, el merge tiene que ser cierto contra las dos, y
// se reporta que la comprobacion es forjable fuera de CI.
function resolveIntegrationRefs(target, branchName) {
  if (!branchName) return { refs: [], forgeable: true };
  const refs = [];
  if (git(["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branchName}`], target).ok) {
    refs.push(`refs/remotes/origin/${branchName}`);
  }
  if (git(["rev-parse", "--verify", "--quiet", `refs/heads/${branchName}`], target).ok) {
    refs.push(`refs/heads/${branchName}`);
  }
  return { refs, forgeable: !detectCiEnvironment().isCi };
}

/**
 * @param {object} input
 * @param {string} input.target
 * @param {string} input.raw                 Contenido de tasks.md.
 * @param {string} [input.slice]              Para verificar las fases con gate humano.
 * @param {string} [input.integrationBranch]  Nombre de rama, ej. "develop". Sin esta, el chequeo de merge se omite (no bloquea: no hay nada contra que comparar).
 * @param {string[]} [input.humanGatePhases]  Fases cuya evidencia se cruza. Default F13/F14.
 */
export function verifyChangeClosure({
  target,
  raw,
  slice = null,
  integrationBranch = null,
  humanGatePhases = ["F13", "F14"]
}) {
  const tasks = parseTasksFile(raw);
  const findings = [];

  // NO-VACUIDAD (regla central del ADR 0007). Un tasks.md sin una sola tarea
  // reconocible cerraba el change en verde: borrar el archivo se detectaba,
  // pero VACIARLO no. "Cero tareas pendientes sobre cero tareas" no es un
  // change terminado, es un ledger que no dice nada — el mismo falso verde por
  // denominador vacio que los gates rechazan con min_denominator.
  if (tasks.length === 0) {
    findings.push({
      level: "error",
      code: "tasks-file-vacuous",
      detail:
        "tasks.md no declara ni una tarea reconocible: cerrar un change sobre un ledger vacio no demuestra que el trabajo se hizo, solo que nadie lo escribio"
    });
  }

  for (const task of tasks) {
    if (task.checked) continue;
    findings.push({
      level: "error",
      code: "task-unchecked",
      line: task.line,
      title: task.title,
      detail: `la tarea '${task.title}' (linea ${task.line}) sigue sin marcar (marca '${task.mark}'): no se puede cerrar el change con trabajo declarado pendiente`
    });
  }

  const { refs: integrationRefs, forgeable } = resolveIntegrationRefs(target, integrationBranch);
  for (const task of tasks) {
    if (!task.checked || !MERGE_TASK_PATTERN.test(task.title)) continue;
    if (integrationRefs.length === 0) {
      // Sin rama contra la que comparar, una tarea de merge marcada [x] es una
      // afirmacion sin verificar. Antes era `warning` y no bloqueaba, asi que
      // apuntar la rama de integracion a un nombre inexistente —dato que sale
      // de .sdlc/config.json, que escribe el propio evaluado— degradaba el
      // error a aviso y devolvia exit 0. Ahora bloquea.
      findings.push({
        level: "error",
        code: "merge-task-unverifiable",
        line: task.line,
        title: task.title,
        detail: `la tarea '${task.title}' declara un merge pero no hay rama de integracion resoluble ('${integrationBranch ?? "sin declarar"}'): no se puede confirmar y no se acepta por confianza`
      });
      continue;
    }
    // Tiene que ser cierto contra TODAS las refs resolubles: si la remota y la
    // local difieren, la mas probable de estar forjada es la remota (se
    // reescribe con un solo `git update-ref`, sin red).
    for (const ref of integrationRefs) {
      if (git(["merge-base", "--is-ancestor", "HEAD", ref], target).ok) continue;
      findings.push({
        level: "error",
        code: "merge-task-not-true",
        line: task.line,
        title: task.title,
        ref,
        detail: `la tarea '${task.title}' (linea ${task.line}) esta marcada como hecha pero HEAD no es antepasado de ${ref}: el merge que declara no ha ocurrido`
      });
    }
  }

  if (forgeable && integrationRefs.length > 0) {
    findings.push({
      level: "warning",
      code: "merge-check-forgeable-outside-ci",
      detail:
        "fuera de un runner, `git update-ref refs/remotes/origin/<rama> HEAD` forja la ref sin red: esta comprobacion solo es autoritativa cuando la corre CI"
    });
  }

  // El cruce del gate humano NO puede ser opt-in. Antes solo corria `if
  // (slice)`, asi que omitir --slice lo saltaba entero y el change cerraba en
  // verde con cero archivos de evidencia en el repo — el control mas caro de
  // la pieza, desactivado por no pasar un argumento.
  if (!slice && humanGatePhases.length > 0) {
    findings.push({
      level: "error",
      code: "human-gate-not-verified",
      detail: `cerrar un change exige --slice para cruzar las fases con gate humano (${humanGatePhases.join(", ")}) contra su evidencia real; sin el, nada confirma que la revision existio`
    });
  } else if (slice) {
    for (const phaseId of humanGatePhases) {
      const readiness = evaluatePhaseReadiness(target, phaseId, slice);
      if (readiness.status !== "ok") {
        findings.push({
          level: "error",
          code: "human-gate-phase-not-ready",
          phase: phaseId,
          detail: `${phaseId} tiene gate humano y su evidencia no esta en ok (status: ${readiness.status}): tasks.md puede decir que se reviso, pero la evidencia real no lo confirma`
        });
      }
    }
  }

  return { ok: !findings.some((finding) => finding.level === "error"), tasks, findings };
}
