// ---------------------------------------------------------------------------
// Validacion de la evidencia por fase.
//
// `schemas/phase-evidence.schema.json` se instalaba en cada consumidor desde
// 1.5.0 y NINGUN codigo lo compilaba: la evidencia podia tener cualquier forma
// y el harness solo comprobaba que el archivo existiera. Este modulo es su
// primer consumidor real.
//
// Validar la FORMA no valida la VERDAD: un YAML bien formado escrito a mano
// sigue siendo una afirmacion del evaluado. La verdad la aporta el arbitro que
// recomputa en CI. Esto es la primera de las dos barreras, no la unica.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
// phase-evidence.schema.json declara draft 2020-12; el export por defecto de
// Ajv 8 solo entiende hasta draft-07 y falla con "no schema with key or ref".
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";

const SCHEMA_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schemas",
  "phase-evidence.schema.json"
);

let _validate = null;

function getValidate() {
  if (_validate) return _validate;
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
  const declaredDraft = String(schema.$schema ?? "");
  const Compiler = declaredDraft.includes("2020-12") ? Ajv2020 : Ajv;
  // `logger: false` porque Ajv escribe sus avisos en stdout y el CLI emite JSON
  // por ahi: un aviso de formato desconocido corrompia la salida del comando.
  const ajv = new Compiler({ allErrors: true, strict: false, logger: false });
  ajv.addFormat("date-time", (value) => typeof value === "string" && !Number.isNaN(Date.parse(value)));
  _validate = ajv.compile(schema);
  return _validate;
}

export function validateEvidenceShape(evidence) {
  const validate = getValidate();
  if (validate(evidence)) return [];
  return (validate.errors ?? []).map((error) => `${error.instancePath || "(root)"}: ${error.message}`);
}

/**
 * Lee y valida un archivo de evidencia.
 * @returns {{ok: boolean, evidence: object|null, errors: string[], code: string|null}}
 */
export function readEvidenceFile(absolutePath) {
  if (!fs.existsSync(absolutePath)) {
    return { ok: false, evidence: null, errors: ["evidencia ausente"], code: "evidence-missing" };
  }
  let parsed;
  try {
    parsed = YAML.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    return { ok: false, evidence: null, errors: [`YAML ilegible: ${error.message}`], code: "evidence-unparseable" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, evidence: null, errors: ["la evidencia debe ser un objeto"], code: "evidence-invalid" };
  }
  const errors = validateEvidenceShape(parsed);
  if (errors.length > 0) {
    return { ok: false, evidence: parsed, errors, code: "evidence-invalid" };
  }
  return { ok: true, evidence: parsed, errors: [], code: null };
}

/**
 * Señales de que la evidencia fue redactada en vez de anexada por el harness.
 * No prueban fraude: marcan lo que un revisor humano o el arbitro debe mirar.
 */
export function detectEvidenceSmells(evidence) {
  const smells = [];
  const quality = evidence?.quality_metrics;
  if (quality) {
    if (quality.source !== "harness" && quality.source !== "ci") {
      smells.push({ code: "evidence-source-unset", detail: "quality_metrics.source no es harness ni ci" });
    }
    if (!quality.tree_hash) {
      smells.push({ code: "evidence-without-tree-hash", detail: "no hay hash del arbol evaluado: la frescura no es verificable" });
    }
    const probes = Array.isArray(quality.probes) ? quality.probes : [];
    for (const probe of probes) {
      if (probe.status === "ok" && !probe.report_sha256) {
        smells.push({
          code: "probe-without-report-hash",
          detail: `el probe ${probe.id} dice ok sin hash de reporte`
        });
      }
    }
    if (probes.length === 0 && quality.metrics && Object.keys(quality.metrics).length > 0) {
      smells.push({
        code: "metrics-without-probes",
        detail: "hay metricas sin ningun probe que las haya producido"
      });
    }
  }
  const signoff = evidence?.human_gate_signoff;
  if (signoff && signoff.required === true) {
    if (signoff.approved_by && !signoff.review_id) {
      smells.push({
        code: "signoff-without-review",
        detail: "la firma humana es texto libre y no un review verificable"
      });
    }
  }
  return smells;
}
