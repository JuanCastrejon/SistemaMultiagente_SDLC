// ---------------------------------------------------------------------------
// Artefacto OpenSpec "acceptance" (ADR 0007, P9)
//
// Gherkin como prosa aprobada, no como capa de ejecucion (docs/research/2026-
// 08-quality-gauntlet-agentic.md, seccion "Gherkin: especificacion firmada,
// no capa de ejecucion"): un humano firma el escenario en F2/F3/F4 antes de
// que exista codigo; la ejecucion real la hace el test runner del consumidor
// via `test_ref`. Vive en openspec/changes/<slice>/acceptance/*.feature.md.
//
// `sc_id` era secuencial (`SC-001`, `SC-002`, ...) antes de esta pieza: dos
// autores agregando escenarios en paralelo, o insertando uno en medio de la
// lista, producian colisiones o renumeraciones que invalidaban un enlace ya
// firmado hacia un test. Un id derivado por hash de (capability, requirement,
// titulo) no colisiona entre autores paralelos y no se mueve si se reordena
// el archivo. Si el titulo cambia de verdad, es razonable que sea un
// escenario distinto con un id distinto: la identidad la da el contenido, no
// un contador que cualquiera puede escribir a mano.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SC_ID_PREFIX = "SC-";
const SC_ID_HASH_LENGTH = 12;

// Separador de campos para el hash. Es NUL a proposito: un separador que
// puede aparecer DENTRO de un campo (un espacio, un guion) permite colisiones
// de concatenacion — ("pagos cobro", "x") y ("pagos", "cobro x") hashearian
// igual. NUL no puede aparecer en un titulo de markdown, asi que la tupla es
// inyectiva.
//
// Se escribe escapado, nunca como byte crudo: este archivo llego a tener un
// NUL literal en el source (detectado por auditoria adversarial), y eso hace
// que el codigo que se lee en un editor no sea evidentemente el que corre —
// justo el tipo de discrepancia que este framework existe para impedir. El
// valor en runtime es identico, asi que los sc_id ya emitidos siguen validos.
const SC_ID_FIELD_SEPARATOR = "\u0000";

export function computeScenarioId({ capability, requirement, title }) {
  const normalized = [capability, requirement, title]
    // NFC antes de comparar: en un framework en espanol los titulos llevan
    // acentos, y el mismo texto visible escrito en macOS (NFD) y en
    // Windows/Linux (NFC) produciria ids distintos — con un mensaje de error
    // que acusaria falsamente de haber cambiado el titulo.
    .map((value) => String(value ?? "").normalize("NFC").trim().toLowerCase().replace(/\s+/g, " "))
    .join(SC_ID_FIELD_SEPARATOR);
  const digest = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
  return `${SC_ID_PREFIX}${digest.slice(0, SC_ID_HASH_LENGTH)}`;
}

const CAPABILITY_PATTERN = /^##\s+Capability:\s*(.+)$/;
const REQUIREMENT_PATTERN = /^###\s+Requirement:\s*(.+)$/;
const SCENARIO_PATTERN = /^####\s+Scenario:\s*(.+)$/;
const SC_ID_COMMENT_PATTERN = /^<!--\s*sc_id:\s*(\S+)\s*-->$/;
const TEST_REF_COMMENT_PATTERN = /^<!--\s*test_ref:\s*(.+?)\s*-->$/;

/**
 * Parsea un archivo .feature.md a capability -> requirement -> scenarios. No
 * valida nada; eso lo hace verifyAcceptanceFile.
 */
export function parseAcceptanceFile(raw) {
  const lines = String(raw ?? "").split(/\r?\n/);
  let capability = null;
  let currentRequirement = null;
  const scenarios = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();

    const capabilityMatch = CAPABILITY_PATTERN.exec(line);
    if (capabilityMatch) {
      capability = capabilityMatch[1].trim();
      continue;
    }
    const requirementMatch = REQUIREMENT_PATTERN.exec(line);
    if (requirementMatch) {
      currentRequirement = requirementMatch[1].trim();
      continue;
    }
    const scenarioMatch = SCENARIO_PATTERN.exec(line);
    if (!scenarioMatch) continue;

    const title = scenarioMatch[1].trim();
    let declaredScId = null;
    let testRef = null;
    // sc_id y test_ref, si vienen, son comentarios HTML en las lineas
    // inmediatamente siguientes (invisibles al render de markdown).
    for (let lookahead = index + 1; lookahead < lines.length; lookahead += 1) {
      const next = lines[lookahead].trim();
      if (next === "") continue;
      const scIdMatch = SC_ID_COMMENT_PATTERN.exec(next);
      if (scIdMatch) {
        declaredScId = scIdMatch[1];
        continue;
      }
      const testRefMatch = TEST_REF_COMMENT_PATTERN.exec(next);
      if (testRefMatch) {
        testRef = testRefMatch[1];
        continue;
      }
      break;
    }

    scenarios.push({ capability, requirement: currentRequirement, title, declaredScId, testRef, line: index + 1 });
  }

  return { capability, scenarios };
}

/**
 * Verifica un archivo: cada escenario debe traer un sc_id cuyo hash coincida
 * con (capability, requirement, titulo) ACTUALES, y ningun sc_id puede
 * repetirse dentro del mismo archivo.
 */
export function verifyAcceptanceFile(raw) {
  const { capability, scenarios } = parseAcceptanceFile(raw);
  const findings = [];
  const seen = new Map();

  for (const scenario of scenarios) {
    if (!scenario.requirement) {
      findings.push({
        level: "error",
        code: "scenario-without-requirement",
        title: scenario.title,
        line: scenario.line,
        detail: `el escenario '${scenario.title}' (linea ${scenario.line}) no esta bajo ningun ### Requirement`
      });
      continue;
    }

    const expected = computeScenarioId(scenario);
    if (!scenario.declaredScId) {
      findings.push({
        level: "error",
        code: "sc-id-missing",
        title: scenario.title,
        line: scenario.line,
        expected,
        detail: `el escenario '${scenario.title}' (linea ${scenario.line}) no declara sc_id; el valor esperado es ${expected}`
      });
      continue;
    }
    if (scenario.declaredScId !== expected) {
      findings.push({
        level: "error",
        code: "sc-id-mismatch",
        title: scenario.title,
        line: scenario.line,
        declared: scenario.declaredScId,
        expected,
        detail: `el escenario '${scenario.title}' (linea ${scenario.line}) declara ${scenario.declaredScId} pero (capability, requirement, titulo) hashea a ${expected}: el titulo o el requirement cambiaron sin recalcular el id`
      });
      continue;
    }
    const previousLine = seen.get(scenario.declaredScId);
    if (previousLine) {
      findings.push({
        level: "error",
        code: "sc-id-duplicate",
        title: scenario.title,
        line: scenario.line,
        detail: `sc_id ${scenario.declaredScId} ya se uso en la linea ${previousLine}`
      });
    } else {
      seen.set(scenario.declaredScId, scenario.line);
    }
  }

  return { capability, scenarios, findings };
}

export function acceptanceDir(target, changeSlug) {
  return path.join(target, "openspec", "changes", changeSlug, "acceptance");
}

/**
 * Verifica TODOS los .feature.md de un change: cada archivo con
 * verifyAcceptanceFile, mas colision de sc_id ENTRE archivos (dos escenarios
 * con el mismo (capability, requirement, titulo) por accidente de copy-paste
 * entre capabilities distintas).
 */
export function verifyAcceptanceDir(target, changeSlug) {
  const dir = acceptanceDir(target, changeSlug);
  if (!fs.existsSync(dir)) {
    return { ok: true, exists: false, files: [], findings: [] };
  }

  const fileNames = fs.readdirSync(dir).filter((name) => name.endsWith(".feature.md")).sort();
  const findings = [];
  const files = [];
  const globalSeen = new Map();

  for (const fileName of fileNames) {
    const raw = fs.readFileSync(path.join(dir, fileName), "utf8");
    const result = verifyAcceptanceFile(raw);
    files.push({ file: fileName, capability: result.capability, scenarios: result.scenarios });
    for (const finding of result.findings) {
      findings.push({ ...finding, file: fileName });
    }
    for (const scenario of result.scenarios) {
      if (!scenario.declaredScId) continue;
      const previous = globalSeen.get(scenario.declaredScId);
      if (previous && previous.file !== fileName) {
        findings.push({
          level: "error",
          code: "sc-id-duplicate-cross-file",
          file: fileName,
          title: scenario.title,
          line: scenario.line,
          detail: `sc_id ${scenario.declaredScId} tambien aparece en ${previous.file}:${previous.line}`
        });
      } else if (!previous) {
        globalSeen.set(scenario.declaredScId, { file: fileName, line: scenario.line });
      }
    }
  }

  // NO-VACUIDAD. Verificar CERO escenarios devolvia `ok` por cuatro caminos
  // distintos —directorio sin archivos, archivo de 0 bytes, encabezados que
  // no calzan el regex, extension distinta de .feature.md— y el resultado no
  // decia cuantos escenarios se habian mirado, asi que aguas abajo nadie podia
  // distinguir "verifique 12" de "verifique 0". Un change que declara tener
  // criterios de aceptacion y no expone ninguno no esta verificado: esta sin
  // medir, y eso no es un pass.
  const scenarioCount = files.reduce((total, entry) => total + entry.scenarios.length, 0);
  if (scenarioCount === 0) {
    findings.push({
      level: "error",
      code: "acceptance-vacuous",
      detail:
        fileNames.length === 0
          ? `${path.relative(target, dir)} existe pero no contiene ningun .feature.md: no hay criterio de aceptacion que verificar`
          : `los ${fileNames.length} archivo(s) de acceptance no exponen ni un escenario reconocible (revisar los encabezados '## Capability:', '### Requirement:' y '#### Scenario:')`
    });
  }

  return {
    ok: !findings.some((finding) => finding.level === "error"),
    exists: true,
    files,
    scenarioCount,
    findings
  };
}
