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

const CHECKBOX_PATTERN = /^[-*]\s+\[( |x|X)\]\s+(.+)$/;
// El texto de la tarea lo escribe un humano o un agente, no un id
// estructurado: el patron es deliberadamente amplio.
const MERGE_TASK_PATTERN = /\bmerge\b|\bmezcla\b|\bfusion(ar)?\b/i;

export function parseTasksFile(raw) {
  const lines = String(raw ?? "").split(/\r?\n/);
  const tasks = [];
  lines.forEach((line, index) => {
    const match = CHECKBOX_PATTERN.exec(line.trim());
    if (!match) return;
    tasks.push({ checked: match[1].toLowerCase() === "x", title: match[2].trim(), line: index + 1 });
  });
  return tasks;
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim(), stderr: result.stderr ?? "" };
}

// Rama de integracion resoluble: la remota si existe (mas confiable, no se
// puede reescribir localmente para simular un merge que no paso), si no la
// local.
function resolveIntegrationRef(target, branchName) {
  if (!branchName) return null;
  if (git(["rev-parse", "--verify", "--quiet", `origin/${branchName}`], target).ok) return `origin/${branchName}`;
  if (git(["rev-parse", "--verify", "--quiet", branchName], target).ok) return branchName;
  return null;
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

  for (const task of tasks) {
    if (task.checked) continue;
    findings.push({
      level: "error",
      code: "task-unchecked",
      line: task.line,
      title: task.title,
      detail: `la tarea '${task.title}' (linea ${task.line}) sigue sin marcar: no se puede cerrar el change con trabajo declarado pendiente`
    });
  }

  const integrationRef = resolveIntegrationRef(target, integrationBranch);
  for (const task of tasks) {
    if (!task.checked || !MERGE_TASK_PATTERN.test(task.title)) continue;
    if (!integrationRef) {
      findings.push({
        level: "warning",
        code: "merge-task-unverifiable",
        line: task.line,
        title: task.title,
        detail: `la tarea '${task.title}' declara un merge pero no hay rama de integracion resoluble (${integrationBranch ?? "sin declarar"}) para confirmarlo`
      });
      continue;
    }
    const isAncestor = git(["merge-base", "--is-ancestor", "HEAD", integrationRef], target).ok;
    if (!isAncestor) {
      findings.push({
        level: "error",
        code: "merge-task-not-true",
        line: task.line,
        title: task.title,
        detail: `la tarea '${task.title}' (linea ${task.line}) esta marcada [x] pero HEAD no es antepasado de ${integrationRef}: el merge que declara no ha ocurrido`
      });
    }
  }

  if (slice) {
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
