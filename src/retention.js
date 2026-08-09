// ---------------------------------------------------------------------------
// Politica de retencion (ADR 0007, P14, decision 7 del cierre de decisiones)
//
// Decision 7: "evidencia permanente append-only; reportes efimeros por path
// y sha256". La evidencia (.github/agent-state/evidence/) es la unica fuente
// de verdad auditable y NUNCA puede perderse -- si un .gitignore generico (de
// un IDE, de una plantilla ajena, de un `*.yaml` demasiado amplio) la excluye
// por accidente, el rastro de auditoria desaparece en silencio en el proximo
// commit. Los reportes nativos (coverage/, reports/, los que cada probe
// declare en `emits`) son bulk regenerable: solo importa su sha256, que YA
// queda anexado en la evidencia (`report_sha256`); mantenerlos versionados
// para siempre es el desperdicio que la decision 7 dice evitar.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { listIgnoredPaths } from "./file-utils.js";
import { loadQualityContract } from "./quality-adjudicate.js";

const PERMANENT_PATHS = [".github/agent-state/evidence", ".github/agent-state/quality-baseline.yaml"];

// Traduccion minima de patrones .gitignore a regex: suficiente para detectar
// los dos accidentes reales (una carpeta excluida por nombre exacto, o un
// glob amplio tipo `*.yaml`), no un motor de gitignore completo.
function gitignorePatternToRegex(pattern) {
  let raw = pattern.trim();
  if (!raw || raw.startsWith("#")) return null;
  const negated = raw.startsWith("!");
  if (negated) raw = raw.slice(1);
  const anchored = raw.startsWith("/");
  if (anchored) raw = raw.slice(1);
  raw = raw.replace(/\/+$/, "");
  if (!raw) return null;
  const escaped = raw
    .split("/")
    .map((segment) =>
      segment
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "\u0000DOUBLESTAR\u0000")
        .replace(/\*/g, "[^/]*")
        .replace(/\u0000DOUBLESTAR\u0000/g, ".*")
    )
    .join("/");
  const source = anchored ? `^${escaped}(?:/.*)?$` : `(^|/)${escaped}(?:/.*)?$`;
  return { regex: new RegExp(source), negated };
}

// Fallback textual, SOLO para cuando git no esta disponible. Reimplementar
// gitignore a mano es inevitablemente incorrecto —la auditoria adversarial
// encontro cinco formas de evadir esta funcion— asi que la autoridad real es
// `git check-ignore` (ver askGitIfIgnored). Esto queda como red de seguridad
// degradada, no como el camino principal.
export function isPathIgnored(gitignoreContent, relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  let ignored = false;
  for (const line of String(gitignoreContent ?? "").split(/\r?\n/)) {
    const compiled = gitignorePatternToRegex(line);
    if (!compiled) continue;
    if (compiled.regex.test(normalized)) ignored = !compiled.negated;
  }
  return ignored;
}

// Devuelve null si git no esta disponible o el target no es un repo: quien
// llama decide (aqui se cae al fallback textual y se marca la degradacion).
//
// Delega en el helper compartido de file-utils porque el ancla de arbol
// (`computeTreeHash`) necesita exactamente el mismo criterio, y dos copias del
// mismo chequeo divergen sin que nadie se entere -- la leccion que dejo
// `detectCliLinked` en este mismo slice, donde la copia y el original acabaron
// contestando cosas distintas sobre el mismo repo.
function askGitIfIgnored(target, relativePaths) {
  return listIgnoredPaths(target, relativePaths);
}

// Los archivos REALES bajo una ruta permanente. El chequeo anterior probaba
// solo la ruta del DIRECTORIO contra los patrones, asi que una regla que
// excluye su contenido (`*.yaml`, `evidence/**`, un .gitignore anidado) dejaba
// toda la evidencia fuera del commit con cero hallazgos.
function listFilesUnder(target, relativeRoot) {
  const absoluteRoot = path.join(target, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const stat = fs.statSync(absoluteRoot);
  if (stat.isFile()) return [relativeRoot];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else out.push(path.relative(target, absolute).replace(/\\/g, "/"));
    }
  };
  walk(absoluteRoot);
  return out;
}

export function checkRetentionPolicy(target) {
  const findings = [];
  const gitignorePath = path.join(target, ".gitignore");
  const gitignoreContent = fs.existsSync(gitignorePath) ? fs.readFileSync(gitignorePath, "utf8") : "";

  for (const permanentPath of PERMANENT_PATHS) {
    // Se pregunta por la ruta Y por cada archivo real debajo: excluir el
    // contenido sin excluir el directorio era el camino mas barato para
    // borrar la evidencia sin que este control dijera nada.
    const candidates = [permanentPath, ...listFilesUnder(target, permanentPath)];
    const ignoredByGit = askGitIfIgnored(target, candidates);

    if (ignoredByGit === null) {
      // Sin git no se puede responder con autoridad. Se usa el fallback y se
      // dice que la respuesta es degradada, en vez de afirmar que todo esta
      // bien porque no se pudo comprobar.
      const ignored = candidates.filter((candidate) => isPathIgnored(gitignoreContent, candidate));
      if (ignored.length > 0) {
        findings.push({
          level: "error",
          code: "retention-permanent-path-ignored",
          path: permanentPath,
          samples: ignored.slice(0, 5),
          detail: `${permanentPath} es evidencia permanente (decision 7, ADR 0007) pero .gitignore la excluye: el rastro de auditoria desaparece en el proximo commit`
        });
      } else if (candidates.length > 1) {
        findings.push({
          level: "warning",
          code: "retention-check-degraded",
          path: permanentPath,
          detail:
            "no se pudo consultar `git check-ignore` (¿git ausente o target fuera de un repo?): la comprobacion cayo al parser textual, que no ve .gitignore anidados ni .git/info/exclude"
        });
      }
      continue;
    }

    if (ignoredByGit.size > 0) {
      findings.push({
        level: "error",
        code: "retention-permanent-path-ignored",
        path: permanentPath,
        ignoredCount: ignoredByGit.size,
        samples: [...ignoredByGit].slice(0, 5),
        detail: `${ignoredByGit.size} ruta(s) de evidencia permanente estan excluidas por git (decision 7, ADR 0007): el rastro de auditoria desaparece en el proximo commit. Confirmado con \`git check-ignore\`, que ve tambien los .gitignore anidados y .git/info/exclude`
      });
    }
  }

  const loaded = loadQualityContract(target);
  if (loaded.ok) {
    const ephemeralDirs = new Set((loaded.contract.probes ?? []).map((probe) => probe.emits?.split("/")[0]).filter(Boolean));
    for (const dir of ephemeralDirs) {
      if (!isPathIgnored(gitignoreContent, dir)) {
        findings.push({
          // "info", no "warning": esto es cierto en CUALQUIER install fresco
          // que aun no configuro su .gitignore, y subirlo a warning tumbaba
          // el exit code limpio de un install nuevo (doctor pasa a exigir
          // --exit-code para que un hallazgo de este nivel importe). El
          // permanente-ignorado de arriba SI es error: ese es el accidente
          // raro y catastrofico; este es el estado de fabrica esperado.
          level: "info",
          code: "retention-ephemeral-path-not-ignored",
          path: dir,
          detail: `${dir}/ contiene reportes nativos regenerables (decision 7: solo importa su sha256, ya anexado en la evidencia); no esta en .gitignore`
        });
      }
    }
  }

  return findings;
}
