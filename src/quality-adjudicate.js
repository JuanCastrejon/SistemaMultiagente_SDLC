// ---------------------------------------------------------------------------
// Adjudicacion desde evidencia ya escrita (sincrona y sin ejecutar nada).
//
// Vive separado de src/quality.js a proposito: ese modulo ejecuta probes y carga
// adapters del consumidor por import dinamico, asi que es asincrono y depende
// del harness. `phase-gate` y `status` necesitan adjudicar SIN ejecutar, y son
// sincronos; importar quality.js desde harness.js crearia un ciclo.
// ---------------------------------------------------------------------------

import path from "node:path";
import YAML from "yaml";
import { pathExists, readPackageScripts, readTextIfExists, sha256Text } from "./file-utils.js";
import { evaluateQualityGates } from "./quality-gates.js";
import { readEvidenceFile, detectEvidenceSmells } from "./evidence-validator.js";
import { loadBaseline, loadBaselineMetrics } from "./quality-baseline.js";

export function loadQualityContract(target) {
  const contractPath = path.join(target, "quality-contract.yaml");
  const raw = readTextIfExists(contractPath);
  if (!raw) return { ok: false, code: "quality-contract-missing", path: contractPath, contract: null };
  try {
    return { ok: true, code: null, path: contractPath, contract: YAML.parse(raw) };
  } catch (error) {
    return { ok: false, code: "quality-contract-unparseable", path: contractPath, contract: null, detail: error.message };
  }
}

// Una superficie cuyo path no existe hace que todo gate sobre ella sea vacuo, y
// "0 violaciones sobre 0 archivos" se ve igual de verde que un repo sano.
export function checkSurfaces(target, contract) {
  const findings = [];
  for (const surface of contract?.surfaces ?? []) {
    if (!pathExists(path.join(target, surface.path))) {
      findings.push({
        level: "error",
        code: "surface-path-unresolved",
        id: surface.id,
        path: surface.path,
        detail: "la superficie declarada no existe en disco: cualquier gate sobre ella seria vacuo"
      });
    }
  }
  return findings;
}

// El arbitro re-ejecuta lo que el package.json del EVALUADO declara para cada
// probe (`validate:coverage`, etc.), sin ninguna garantia de que ese script
// siga siendo el mismo que se reviso: reemplazarlo por algo que escribe
// numeros perfectos sin correr nada real es indetectable sin esto. La
// contramedida vive en quality-contract.yaml (ruta protegida por el guard de
// frontera, ADR 0007 P2) porque cambiar el hash anclado exige el mismo review
// humano que cualquier otro cambio de contrato.
//
// Un probe sin `command_sha256` no bloquea (escalera de adopcion, igual que
// los gates): solo avisa y sugiere el valor a anclar, para no romper contratos
// existentes el dia que esto se agrega.
// El ancla cubre la CADENA COMPLETA que el package manager ejecuta, no solo
// el script nombrado. Dos huecos reproducidos por la auditoria adversarial:
//
// 1. npm/pnpm/yarn invocan `pre<cmd>` y `post<cmd>` automaticamente. Agregar
//    un `prevalidate:coverage` que sobrescribe el reporte envuelve al probe
//    SIN tocar una sola letra del texto anclado: el hash seguia calzando.
// 2. El texto anclado suele ser `node scripts/probe.mjs`. Ese texto no cambia
//    nunca; lo que cambia es el ARCHIVO al que apunta, que no estaba cubierto
//    por nada. El ancla solo cerraba el primer salto de la cadena.
//
// Por eso el hash efectivo se calcula sobre: los tres scripts de la cadena
// (los ausentes se marcan como ausentes, para que agregar un `pre` despues
// rompa el ancla) mas el contenido de los archivos locales que esos scripts
// referencian. Un ancla que solo cubre parte de lo que se ejecuta no es un
// ancla, es un adorno.
const SCRIPT_FILE_TOKEN = /(?:^|[\s"'=])((?:\.{0,2}\/)?[\w.@/-]+\.(?:mjs|cjs|js|ts|sh|ps1|py))(?=[\s"']|$)/g;

function collectReferencedFiles(target, text) {
  const files = [];
  for (const match of String(text ?? "").matchAll(SCRIPT_FILE_TOKEN)) {
    const relative = match[1];
    if (relative.startsWith("/") || /^[A-Za-z]:/.test(relative)) continue; // rutas absolutas: fuera del repo
    const absolute = path.join(target, relative);
    if (!pathExists(absolute)) continue;
    files.push({ relative, content: readTextIfExists(absolute) ?? "" });
  }
  return files;
}

export function resolveProbeChain(target, declaredScripts, command) {
  const parts = [];
  const referenced = [];
  for (const name of [`pre${command}`, command, `post${command}`]) {
    const text = declaredScripts[name];
    if (typeof text !== "string") {
      // El hueco se registra explicitamente: si manana aparece un `pre`, el
      // hash cambia y el ancla rompe, que es justo lo que debe pasar.
      parts.push(`${name}\u0000<ausente>`);
      continue;
    }
    parts.push(`${name}\u0000${text}`);
    for (const file of collectReferencedFiles(target, text)) {
      referenced.push(file.relative);
      parts.push(`file:${file.relative}\u0000${file.content}`);
    }
  }
  return { digest: sha256Text(parts.join("\u0000\u0000")), referenced, declared: typeof declaredScripts[command] === "string" };
}

export function checkProbeAnchors(target, contract) {
  const findings = [];
  const declaredScripts = readPackageScripts(target) ?? {};
  for (const probe of contract?.probes ?? []) {
    const chain = resolveProbeChain(target, declaredScripts, probe.command);
    const actual = chain.declared ? chain.digest : null;

    if (!probe.command_sha256) {
      if (actual) {
        findings.push({
          level: "warning",
          code: "probe-command-unpinned",
          id: probe.id,
          command: probe.command,
          actual,
          detail: `el probe ${probe.id} no ancla '${probe.command}' con command_sha256; valor actual para anclar en quality-contract.yaml: ${actual}`
        });
      }
      continue;
    }

    if (actual === null) {
      findings.push({
        level: "error",
        code: "probe-script-missing-pinned",
        id: probe.id,
        command: probe.command,
        detail: `el probe ${probe.id} ancla '${probe.command}' (${probe.command_sha256.slice(0, 12)}) pero package.json ya no lo declara`
      });
      continue;
    }

    if (actual !== probe.command_sha256) {
      findings.push({
        level: "error",
        code: "probe-script-drift",
        id: probe.id,
        command: probe.command,
        actual,
        detail: `el script '${probe.command}' del probe ${probe.id} cambio: anclado ${probe.command_sha256.slice(0, 12)}, ahora ${actual.slice(0, 12)}`
      });
    }
  }
  return findings;
}

// Para `sdlc doctor`: la misma verificacion, sin exigir que exista una
// corrida de quality-gate. Si no hay contrato todavia, no hay nada que anclar.
export function probeAnchorDoctorFindings(target) {
  const loaded = loadQualityContract(target);
  if (!loaded.ok) return [];
  return checkProbeAnchors(target, loaded.contract);
}

export function resolveTier(contract, surfaceId = null) {
  const surfaces = contract?.surfaces ?? [];
  if (surfaceId) {
    return surfaces.find((surface) => surface.id === surfaceId)?.tier ?? null;
  }
  // Sin superficie explicita se toma el tier mas estricto declarado: ante la
  // duda el gate debe pedir mas, no menos.
  for (const tier of ["core", "standard", "shell"]) {
    if (surfaces.some((surface) => surface.tier === tier)) return tier;
  }
  return null;
}

/**
 * Adjudica los gates de una fase leyendo la evidencia ya escrita. No ejecuta
 * probes, asi que su veredicto es siempre advisory salvo que quien lo invoque
 * pueda demostrar que la evidencia la produjo un arbitro.
 */
export function adjudicateFromEvidence(target, { slice, phase, evidencePath: explicitPath = null, gateIds = null } = {}) {
  const loaded = loadQualityContract(target);
  if (!loaded.ok) {
    return { status: "not-configured", code: loaded.code, evaluated: [], violations: [], warnings: [], vacuous: [] };
  }
  const contract = loaded.contract;
  const evidenceAbsolute =
    explicitPath ?? path.join(target, ".github", "agent-state", "evidence", String(slice), `${phase}.yaml`);

  const read = readEvidenceFile(evidenceAbsolute);
  if (!read.ok) {
    return {
      status: "no-evidence",
      code: read.code,
      errors: read.errors,
      evaluated: [],
      violations: [],
      warnings: [],
      vacuous: []
    };
  }

  const smells = detectEvidenceSmells(read.evidence).map((smell) => ({ level: "warning", ...smell }));
  const surfaceFindings = checkSurfaces(target, contract);
  // El ancla se re-verifica tambien al adjudicar desde evidencia. Antes solo
  // la miraba `quality-gate --run`, asi que `phase-gate` y `status` daban
  // verde sobre un probe cuyo script ya no era el anclado — el veredicto que
  // un humano lee para decidir si avanzar de fase no puede ignorar que la
  // medicion la produjo codigo distinto del revisado.
  surfaceFindings.push(...checkProbeAnchors(target, contract));

  // Un baseline manipulado no puede alimentar un ratchet: si el hash de
  // integridad no cuadra, se adjudica como si no hubiera baseline (todo gate
  // ratchet pasa sin comparar) y se reporta el hallazgo por separado, para que
  // quien lea el resultado sepa que el ratchet no esta comparando nada.
  const baselineState = loadBaseline(target);
  if (baselineState.tampered) {
    surfaceFindings.push({
      level: "error",
      code: "baseline-tampered",
      detail: "el baseline no supero su verificacion de integridad; los gates ratchet se evaluaron sin comparacion"
    });
  }
  const baseline = baselineState.tampered ? {} : loadBaselineMetrics(target);
  const tier = resolveTier(contract);

  // Si la fase declara sus gates en phase-contract, solo esos se adjudican.
  const gates = Array.isArray(gateIds) && gateIds.length > 0
    ? (contract.gates ?? []).filter((gate) => gateIds.includes(gate.id))
    : contract.gates ?? [];

  // Un gate que esta fase declara puede pertenecer a OTRA fase de origen
  // (gate.phase != phase): es HEREDADO. F14 (merge) no mide nada propio -- sus
  // gates son siempre de F8/F9/F10, y se re-verifican leyendo la evidencia de
  // la fase que SI los midio, en vez de fabricar un mecanismo de arrastre no
  // verificado (ADR 0007, gap documentado en 1.11.0, cerrado aqui). El gate
  // nunca se evalua contra la evidencia de ESTA fase si no es la que lo midio.
  const ownGates = [];
  const inheritedGroups = new Map();
  for (const gate of gates) {
    const origin = gate.phase ?? phase;
    if (origin === phase) {
      ownGates.push(gate);
    } else {
      if (!inheritedGroups.has(origin)) inheritedGroups.set(origin, []);
      inheritedGroups.get(origin).push(gate);
    }
  }

  const declaredByContract = Array.isArray(gateIds) ? gateIds : null;
  const ownMetrics = read.evidence?.quality_metrics?.metrics ?? {};
  const groupResults = [evaluateQualityGates({ gates: ownGates, metrics: ownMetrics, phase, tier, baseline, declaredByContract })];
  const inherited = [];

  // El arbol sobre el que ESTA fase se midio. Es la referencia contra la que se
  // comprueba la frescura de lo heredado: aqui no se recorre el disco a
  // proposito (este modulo es sincrono y no ejecuta nada), y comparar contra el
  // arbol de trabajo daria falso positivo en cualquier lectura advisory con
  // cambios sin medir. Comparar los dos hashes YA REGISTRADOS responde justo lo
  // que importa: ¿la metrica heredada se midio sobre el mismo arbol que esta?
  const ownTreeHash = read.evidence?.quality_metrics?.tree_hash ?? null;
  for (const [originPhase, originGates] of inheritedGroups) {
    const originAbsolute = path.join(target, ".github", "agent-state", "evidence", String(slice), `${originPhase}.yaml`);
    const originRead = readEvidenceFile(originAbsolute);
    // Sin evidencia legible en la fase de origen, se adjudica sobre metricas
    // vacias: cada gate heredado sale `not-measured`, nunca `pass` por vacio.
    const originMetrics = originRead.ok ? originRead.evidence?.quality_metrics?.metrics ?? {} : {};
    const originTreeHash = originRead.ok ? originRead.evidence?.quality_metrics?.tree_hash ?? null : null;
    groupResults.push(
      evaluateQualityGates({ gates: originGates, metrics: originMetrics, phase: originPhase, tier, baseline, declaredByContract })
    );
    inherited.push({
      phase: originPhase,
      evidenceFound: originRead.ok,
      evidenceSource: originRead.ok ? originRead.evidence?.quality_metrics?.source ?? null : null,
      treeHash: originTreeHash,
      ownTreeHash,
      treeMatches: originRead.ok && originTreeHash !== null && ownTreeHash !== null ? originTreeHash === ownTreeHash : null
    });
    // Heredar una metrica es heredar el arbol sobre el que se midio. Sin este
    // anclaje, una fase que no mide nada propio (F14) adjudicaba con metricas
    // de un arbol anterior y salia `ok`. Ver el PoC en tests/phase-inheritance.
    if (originRead.ok && originTreeHash !== null && ownTreeHash !== null && originTreeHash !== ownTreeHash) {
      surfaceFindings.push({
        level: "error",
        code: "inherited-evidence-stale",
        phase: originPhase,
        expected: ownTreeHash,
        actual: originTreeHash,
        detail: `${phase} hereda gates de ${originPhase}, pero esa evidencia midio otro arbol (${originTreeHash.slice(0, 12)} != ${ownTreeHash.slice(0, 12)}): hay que volver a correr ${originPhase} sobre el arbol actual`
      });
    }
  }

  const adjudication = {
    status: groupResults.some((result) => result.violations.length > 0)
      ? "blocked"
      : groupResults.some((result) => result.warnings.length > 0)
        ? "warning"
        : "ok",
    evaluated: groupResults.flatMap((result) => result.evaluated),
    violations: groupResults.flatMap((result) => result.violations),
    warnings: groupResults.flatMap((result) => result.warnings),
    vacuous: groupResults.flatMap((result) => result.vacuous)
  };

  const surfaceErrors = surfaceFindings.filter((finding) => finding.level === "error");
  const blocked = adjudication.violations.length > 0 || surfaceErrors.length > 0;

  return {
    ...adjudication,
    status: blocked ? "blocked" : adjudication.status === "warning" || smells.length > 0 ? "warning" : "ok",
    evidenceSource: read.evidence?.quality_metrics?.source ?? null,
    treeHash: read.evidence?.quality_metrics?.tree_hash ?? null,
    inherited: inherited.length > 0 ? inherited : undefined,
    baselinePromotedAt: baselineState.baseline?.promoted_at ?? null,
    findings: [...surfaceFindings, ...smells]
  };
}
