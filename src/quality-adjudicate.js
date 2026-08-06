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
import { pathExists, readTextIfExists } from "./file-utils.js";
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

  const metrics = read.evidence?.quality_metrics?.metrics ?? {};
  const smells = detectEvidenceSmells(read.evidence).map((smell) => ({ level: "warning", ...smell }));
  const surfaceFindings = checkSurfaces(target, contract);

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

  // Si la fase declara sus gates en phase-contract, solo esos se adjudican.
  const gates = Array.isArray(gateIds) && gateIds.length > 0
    ? (contract.gates ?? []).filter((gate) => gateIds.includes(gate.id))
    : contract.gates ?? [];

  const adjudication = evaluateQualityGates({
    gates,
    metrics,
    phase,
    tier: resolveTier(contract),
    baseline,
    // Los gates que la fase declara en phase-contract.yaml son promesas de
    // medicion: no medirlos es incumplir el contrato, no un aviso.
    declaredByContract: Array.isArray(gateIds) ? gateIds : null
  });

  const surfaceErrors = surfaceFindings.filter((finding) => finding.level === "error");
  const blocked = adjudication.violations.length > 0 || surfaceErrors.length > 0;

  return {
    ...adjudication,
    status: blocked ? "blocked" : adjudication.status === "warning" || smells.length > 0 ? "warning" : "ok",
    evidenceSource: read.evidence?.quality_metrics?.source ?? null,
    treeHash: read.evidence?.quality_metrics?.tree_hash ?? null,
    baselinePromotedAt: baselineState.baseline?.promoted_at ?? null,
    findings: [...surfaceFindings, ...smells]
  };
}
