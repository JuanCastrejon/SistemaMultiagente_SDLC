import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { pathExists, readPackageScripts, readTextIfExists } from "./file-utils.js";
import { detectEvidenceSmells, readEvidenceFile } from "./evidence-validator.js";
import { adjudicateFromEvidence, loadQualityContract } from "./quality-adjudicate.js";
import { detectCiEnvironment } from "./ci-detect.js";
import { describeTools } from "./external-tools.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function normalize(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

// En Windows hay que pasar por el shell: desde la mitigacion de CVE-2024-27980,
// Node se niega a ejecutar `.cmd`/`.bat` (npm.cmd, corepack.cmd, yarn.cmd) sin
// shell. Como el shell interpreta metacaracteres, la defensa no puede ser
// escapar: es RECHAZAR. Cualquier token con metacaracteres de cmd.exe se
// bloquea antes de construir la linea, en vez de intentar quotearlo.
//
// Importa mas de lo que parece: cuando el contrato de calidad permita declarar
// `probes[].command` en el YAML del consumidor, ese valor llega hasta aqui.
const SHELL_METACHARACTERS = /[&|<>^"`$\n\r;()!%]/;

export function assertShellSafeToken(token, role) {
  const text = String(token);
  if (SHELL_METACHARACTERS.test(text)) {
    const error = new Error(
      `Token no permitido en ${role}: contiene metacaracteres de shell (${text.slice(0, 60)}).`
    );
    error.code = "UNSAFE_COMMAND_TOKEN";
    throw error;
  }
  return text;
}

function runCommand(command, args = [], cwd = process.cwd(), timeout = 8000) {
  const windowsShell = process.platform === "win32";
  if (windowsShell) {
    assertShellSafeToken(command, "comando");
    for (const arg of args) {
      assertShellSafeToken(arg, "argumento");
    }
  }
  const quoteWindowsArg = (value) => {
    const text = String(value);
    return /\s/.test(text) ? `"${text}"` : text;
  };
  const result = windowsShell
    ? spawnSync([command, ...args].map(quoteWindowsArg).join(" "), {
        cwd,
        encoding: "utf8",
        shell: true,
        timeout
      })
    : spawnSync(command, args, {
        cwd,
        encoding: "utf8",
        timeout
      });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error?.message
  };
}

function firstLine(value) {
  return normalize(value).split("\n")[0] ?? "";
}

// ---------------------------------------------------------------------------
// Package manager detection
// The harness used to hardcode `corepack pnpm`, which made `verdict` and
// `tools-doctor` fail on npm or yarn consumers. Resolution order:
//   1. package.json "packageManager" field (corepack standard)
//   2. lockfile present in the target repo
//   3. pnpm as historical default
// ---------------------------------------------------------------------------

const PACKAGE_MANAGERS = {
  pnpm: {
    name: "pnpm",
    versionCommand: ["corepack", ["pnpm", "--version"]],
    runScript: (script) => ["corepack", ["pnpm", "run", script, "--if-present"]]
  },
  npm: {
    name: "npm",
    versionCommand: ["npm", ["--version"]],
    runScript: (script) => ["npm", ["run", "--if-present", script]]
  },
  yarn: {
    name: "yarn",
    versionCommand: ["yarn", ["--version"]],
    runScript: (script) => ["yarn", ["run", script]]
  },
  bun: {
    name: "bun",
    versionCommand: ["bun", ["--version"]],
    runScript: (script) => ["bun", ["run", script]]
  }
};

export function detectPackageManager(target) {
  const packageJsonPath = path.join(target, "package.json");
  const raw = readTextIfExists(packageJsonPath);
  if (raw) {
    try {
      const declared = JSON.parse(raw).packageManager;
      if (typeof declared === "string") {
        const name = declared.split("@")[0].trim().toLowerCase();
        if (PACKAGE_MANAGERS[name]) {
          return { ...PACKAGE_MANAGERS[name], source: "packageManager" };
        }
      }
    } catch {
      /* package.json ilegible: se cae a los lockfiles */
    }
  }
  for (const [lockfile, name] of [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"]
  ]) {
    if (pathExists(path.join(target, lockfile))) {
      return { ...PACKAGE_MANAGERS[name], source: lockfile };
    }
  }
  return { ...PACKAGE_MANAGERS.pnpm, source: "default" };
}

function contractCandidates(target) {
  const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return [
    path.join(target, "phase-contract.yaml"),
    path.join(target, ".github", "agent-state", "phase-contract.yaml"),
    path.join(moduleRoot, "phase-contract.yaml")
  ];
}

// Version de contrato que este engine entiende. v2 anade `quality_gates` por
// fase; v1 sigue siendo valido y simplemente no adjudica calidad.
export const CONTRACT_VERSION_EXPECTED = 2;

export function loadPhaseContract(target) {
  for (const candidate of contractCandidates(target)) {
    if (!pathExists(candidate)) continue;
    const raw = fs.readFileSync(candidate, "utf8");
    const parsed = YAML.parse(raw);
    const phases = Array.isArray(parsed?.phases) ? parsed.phases : [];
    return { path: candidate, version: parsed?.version ?? 1, phases };
  }
  return { path: null, version: null, phases: [] };
}

function findPhase(contract, phaseId) {
  return contract.phases.find((phase) => String(phase.id).toUpperCase() === String(phaseId).toUpperCase()) ?? null;
}

function resolveArtifact(target, slice, artifact) {
  const replaced = String(artifact)
    .replaceAll("<slice>", slice)
    .replaceAll("{slice}", slice)
    .replaceAll("<slice-id>", slice)
    .replaceAll("{slice_id}", slice);
  return path.resolve(target, replaced);
}

function checkArtifacts(target, slice, artifacts = []) {
  return artifacts.map((artifact) => {
    const absolute = resolveArtifact(target, slice, artifact);
    return {
      path: artifact,
      absolute,
      exists: pathExists(absolute)
    };
  });
}

function evidencePath(target, slice, phaseId) {
  return path.join(target, ".github", "agent-state", "evidence", slice, `${phaseId}.yaml`);
}

export function evaluatePhaseReadiness(target, phaseId, slice) {
  const contract = loadPhaseContract(target);
  const phase = findPhase(contract, phaseId);
  if (!contract.path) {
    return {
      status: "error",
      contractPath: null,
      message: "No se encontro phase-contract.yaml.",
      phase: phaseId,
      slice
    };
  }
  if (!phase) {
    return {
      status: "error",
      contractPath: contract.path,
      message: `Fase no declarada en phase-contract.yaml: ${phaseId}`,
      phase: phaseId,
      slice
    };
  }

  const inputs = checkArtifacts(target, slice, phase.inputs_required ?? []);
  const outputs = checkArtifacts(target, slice, phase.outputs_required ?? []);
  const missingInputs = inputs.filter((entry) => !entry.exists);
  const missingOutputs = outputs.filter((entry) => !entry.exists);
  const evidenceAbsolute = evidencePath(target, slice, phase.id);
  const evidence = {
    path: evidenceAbsolute,
    required: Boolean(phase.evidence_required),
    exists: pathExists(evidenceAbsolute)
  };

  // Hasta 1.8.0 el gate solo comprobaba que el archivo EXISTIERA: nunca lo
  // abria. Un YAML vacio, corrupto o con cualquier forma pasaba igual. Ahora se
  // lee y se valida contra el schema que el framework ya instalaba sin usar.
  const evidenceBlockers = [];
  const evidenceWarnings = [];

  // Guard de version: un contrato v1 leido por un engine que ya entiende v2
  // funciona, pero se dice en voz alta en vez de degradar en silencio.
  const contractVersion = contract.version ?? 1;
  if (contractVersion < CONTRACT_VERSION_EXPECTED) {
    evidenceWarnings.push(`contract-version-outdated:v${contractVersion}`);
  }
  if (evidence.exists) {
    const read = readEvidenceFile(evidenceAbsolute);
    evidence.valid = read.ok;
    if (!read.ok) {
      evidence.errors = read.errors;
      // Evidencia invalida solo bloquea donde la evidencia es obligatoria; en
      // el resto de fases se reporta sin detener el flujo.
      if (evidence.required) evidenceBlockers.push(`${read.code}:${path.relative(target, evidenceAbsolute)}`);
      else evidenceWarnings.push(`${read.code}:${path.relative(target, evidenceAbsolute)}`);
    } else {
      // Las expectativas vienen del contrato de la fase: si declara gates de
      // calidad PROPIOS tiene que traer mediciones, y si tiene gate humano
      // tiene que traer firma. Sin esto, una evidencia valida pero VACIA
      // pasaba limpia.
      //
      // "Propios" no es lo mismo que "declarados": F14 (merge) declara gates
      // de F8/F9/F10 para re-verificarlos antes de fusionar (herencia,
      // src/quality-adjudicate.js), pero F14 nunca mide nada por si misma. Si
      // se exigiera quality_metrics en F14.yaml por el solo hecho de listar
      // gates heredados, toda evidencia de F14 legitima (sin mediciones
      // propias) se marcaria como sospechosa por algo que nunca prometio.
      const declaredGateIds = Array.isArray(phase.quality_gates) ? phase.quality_gates : [];
      let declaresOwnQualityGates = declaredGateIds.length > 0;
      if (declaredGateIds.length > 0) {
        const qualityContractLoaded = loadQualityContract(target);
        if (qualityContractLoaded.ok) {
          const gatesById = new Map((qualityContractLoaded.contract.gates ?? []).map((gate) => [gate.id, gate]));
          // Un id declarado que no resuelve en quality-contract.yaml se trata
          // como propio por omision: silenciar el aviso por un id roto seria
          // el vacio equivocado.
          declaresOwnQualityGates = declaredGateIds.some((gateId) => {
            const gate = gatesById.get(gateId);
            return !gate || gate.phase === phase.id;
          });
        }
      }
      const smells = detectEvidenceSmells(read.evidence, {
        expectsQualityMetrics: declaresOwnQualityGates,
        expectsSignoff: Boolean(phase.human_gate)
      });
      if (smells.length > 0) {
        evidence.smells = smells;
        for (const smell of smells) {
          // Un olor de nivel error en una fase que exige evidencia bloquea; el
          // resto sigue siendo senal para el revisor.
          if (smell.level === "error" && evidence.required) evidenceBlockers.push(smell.code);
          else evidenceWarnings.push(smell.code);
        }
      }
      // El gate humano deja de ser un campo de texto que el propio agente puede
      // escribir: exige la referencia a un review verificable.
      if (phase.human_gate) {
        const signoff = read.evidence.human_gate_signoff;
        if (!signoff || signoff.approved_by === null || signoff.approved_by === undefined) {
          evidenceBlockers.push("human-gate-signoff-missing");
        } else if (!signoff.review_id) {
          evidenceWarnings.push("human-gate-signoff-unverifiable");
        }
      }
    }
  }

  // phase-contract v2: la fase puede declarar que gates del contrato de calidad
  // le aplican. Se adjudican desde la evidencia ya escrita, sin ejecutar nada:
  // ejecutar es responsabilidad de `quality-gate --run`.
  let quality = null;
  const declaredGates = Array.isArray(phase.quality_gates) ? phase.quality_gates : null;
  if (declaredGates && declaredGates.length > 0 && evidence.exists) {
    const adjudication = adjudicateFromEvidence(target, {
      slice,
      phase: phase.id,
      gateIds: declaredGates
    });
    if (adjudication.status !== "not-configured") {
      quality = {
        status: adjudication.status,
        gates: declaredGates,
        evaluated: adjudication.evaluated,
        vacuous: adjudication.vacuous,
        // `findings` trae los hallazgos que no son de gate: superficie
        // fantasma, baseline manipulado y el drift del ancla del probe. Se
        // calculaban y se DESCARTABAN aqui, asi que nunca llegaban a quien lee
        // `phase-gate` para decidir si la fase avanza.
        findings: adjudication.findings ?? [],
        evidenceSource: adjudication.evidenceSource,
        treeHash: adjudication.treeHash
      };
      for (const finding of adjudication.findings ?? []) {
        if (finding.level === "error") evidenceBlockers.push(`quality-${finding.code}${finding.id ? `:${finding.id}` : ""}`);
        else if (finding.level === "warning") evidenceWarnings.push(`quality-${finding.code}`);
      }
      for (const violation of adjudication.violations) {
        evidenceBlockers.push(`quality-${violation.code}:${violation.id ?? violation.metric ?? ""}`);
      }
      for (const warning of adjudication.warnings) {
        evidenceWarnings.push(`quality-${warning.code}:${warning.id ?? ""}`);
      }
    }
  }

  const blocked =
    missingInputs.length > 0 ||
    missingOutputs.length > 0 ||
    (evidence.required && !evidence.exists) ||
    evidenceBlockers.length > 0;

  return {
    status: blocked ? "blocked" : "ok",
    contractPath: contract.path,
    contractVersion: contract.version ?? 1,
    phase: phase.id,
    slice,
    owner: phase.owner,
    participants: phase.participants ?? [],
    humanGate: Boolean(phase.human_gate),
    nextPhase: phase.next_phase ?? null,
    inputs,
    outputs,
    evidence,
    quality,
    missingInputs,
    missingOutputs,
    warnings: evidenceWarnings,
    blockers: [
      ...missingInputs.map((entry) => `input-missing:${entry.path}`),
      ...missingOutputs.map((entry) => `output-missing:${entry.path}`),
      ...(evidence.required && !evidence.exists ? [`evidence-missing:${path.relative(target, evidence.path)}`] : []),
      ...evidenceBlockers
    ]
  };
}

export function commandPhaseGate(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const phase = options.phase;
  const slice = options.slice;
  const exitCodeMode = Boolean(options["exit-code"] ?? options.exitCode);
  if (!phase || !slice) {
    return {
      exitCode: EXIT_ERROR,
      payload: {
        status: "error",
        message: "Faltan --phase <F0-F17> y --slice <id>."
      }
    };
  }
  const result = evaluatePhaseReadiness(target, phase, slice);
  // Without --exit-code: informative (exit 0 even when blocked, for P0 wiring).
  // With --exit-code: hard-block when blocked (P2 wiring). ADR-0006.
  const exitCode = result.status === "error"
    ? EXIT_ERROR
    : exitCodeMode && result.status === "blocked"
      ? EXIT_ACTION_REQUIRED
      : EXIT_OK;
  return { exitCode, payload: result };
}

// ---------------------------------------------------------------------------
// commandVerdict (ADR-0006 / ADR-024 P2)
// Runs host validate:* scripts in a deterministic ordered fail-fast sequence.
// Classifies each step as BLOCKING or WARNING and emits a single
// {status: "ready"|"not-ready"} verdict. Writes artifact when --write is set.
// ---------------------------------------------------------------------------

const VERDICT_STEPS = [
  { key: "control-plane",        script: "validate:control-plane",        level: "BLOCKING" },
  { key: "drift",                script: "validate:drift",                 level: "BLOCKING" },
  { key: "slice-traceability",   script: "validate:slice-traceability",    level: "BLOCKING" },
  { key: "surface-traceability", script: "validate:surface-traceability",  level: "BLOCKING" },
  { key: "semantic-guardrails",  script: "validate:semantic-guardrails",   level: "BLOCKING" },
  { key: "adr-integrity",        script: "validate:adr-integrity",         level: "BLOCKING" },
  { key: "openspec",             script: "validate:openspec",              level: "BLOCKING" },
  { key: "active-slices",        script: "validate:active-slices",         level: "WARNING"  },
];

// Un paso cuyo script no existe en el package.json del consumidor NO se ejecuta.
// Los invocadores usan `--if-present` (npm/pnpm), que sale 0 cuando el script
// falta: sin este precheck, un paso BLOCKING inexistente se reportaba `pass` y
// contribuia a un READY falso. Se reporta `not-configured`, que no es pass ni
// fail y no dispara el fail-fast.
//
// La implementacion vive en file-utils.js (no aqui) porque quality-adjudicate.js
// tambien la necesita para anclar los scripts de los probes por hash, y
// quality-adjudicate no puede importar de harness.js: harness.js ya importa de
// quality-adjudicate, y eso cerraria un ciclo. Se re-exporta para no romper a
// quien ya la importaba desde aqui.
export { readPackageScripts };

/**
 * Ejecuta un script del consumidor con el package manager detectado, aplicando
 * el mismo precheck que `verdict`: un script no declarado NO se invoca y se
 * reporta como `not-configured`, porque `--if-present` sale 0 y produciria un
 * falso pass.
 */
export function runPackageScript(target, packageManager, script, timeout = 60_000) {
  const declared = readPackageScripts(target);
  if (declared && !Object.prototype.hasOwnProperty.call(declared, script)) {
    return { status: "not-configured", ok: false, exitCode: null, stdout: "", stderr: "" };
  }
  const [command, args] = packageManager.runScript(script);
  const result = runCommand(command, args, target, timeout);
  return {
    status: result.ok ? "ok" : "failed",
    ok: result.ok,
    exitCode: result.status ?? (result.ok ? 0 : 1),
    stdout: result.stdout,
    stderr: result.stderr
  };
}

export function commandVerdict(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const write = Boolean(options.write);
  const slice = options.slice ?? null;
  const phase = options.phase ?? null;
  const blockers = [];
  const warnings = [];
  const notConfigured = [];
  const steps = [];
  const packageManager = detectPackageManager(target);
  // `null` = no hay package.json legible.
  //
  // Antes eso significaba "no puedo prechequear, ejecuto todo como antes para
  // no romper consumidores que no son Node". La intencion era buena y el efecto
  // el contrario: sin package.json, `pnpm run <script>` falla SIEMPRE, asi que
  // todos los pasos BLOCKING salian `fail` y el veredicto acusaba al validador
  // equivocado. Reproducido instalando la 1.8.0 en un repo brownfield real sin
  // package.json: `verdict` decia `control-plane: fail (exit 1)` mientras
  // `node scripts/validators/validate-control-plane.mjs` salia 0 con "OK: 10
  // referencias resuelven". Quien lo viera iria a depurar un archivo sano.
  //
  // Sin package.json no hay NINGUN script declarado, que es exactamente el caso
  // que `not-configured` ya modela: ni pass (no se puede fingir que corrio) ni
  // fail (no hay nada roto). Se reutiliza esa semantica en vez de inventar otra.
  const declaredScripts = readPackageScripts(target);
  const hasManifest = declaredScripts !== null;

  for (const step of VERDICT_STEPS) {
    if (!hasManifest || !Object.prototype.hasOwnProperty.call(declaredScripts, step.script)) {
      notConfigured.push(step.key);
      steps.push({
        key: step.key,
        script: step.script,
        level: step.level,
        status: "not-configured",
        exitCode: null,
        detail: hasManifest
          ? `El consumidor no declara el script ${step.script} en package.json.`
          : "El consumidor no tiene package.json: el harness no puede ejecutar validators. Si es un repo Node, crear package.json y declarar los scripts validate:*."
      });
      continue;
    }
    const [command, args] = packageManager.runScript(step.script);
    const result = runCommand(command, args, target, 60_000);
    const passed = result.ok;
    const entry = {
      key: step.key,
      script: step.script,
      level: step.level,
      status: passed ? "pass" : "fail",
      exitCode: result.status ?? (passed ? 0 : 1),
      stderr: result.stderr ? result.stderr.slice(0, 400) : undefined
    };
    steps.push(entry);
    if (!passed) {
      if (step.level === "BLOCKING") {
        blockers.push(step.key);
        break; // fail-fast on first BLOCKING failure
      } else {
        warnings.push(step.key);
      }
    }
  }

  // VACUIDAD. Si NINGUN paso llego a ejecutarse, no hay nada verificado, y
  // "no se pudo medir" no puede parecerse a "todo bien" — es la regla que el
  // resto del gauntlet aplica (`gate: vacuous`, `red-proof-vacuous`).
  //
  // Sin esto, arreglar el bug de package.json cambiaba un falso rojo por un
  // falso VERDE: los 8 pasos salian `not-configured`, `blockers` quedaba vacio
  // y el veredicto era READY sobre un repo donde no corrio un solo validator.
  // El falso verde es peor que el falso rojo: nadie lo va a investigar.
  const executed = steps.filter((entry) => entry.status === "pass" || entry.status === "fail");
  const vacuous = executed.length === 0 && steps.length > 0;
  const ready = blockers.length === 0 && !vacuous;

  const payload = {
    status: vacuous ? "not-configured" : ready ? "ready" : "not-ready",
    verdict: vacuous ? "NOT-VERIFIABLE" : ready ? "READY" : "NOT-READY",
    packageManager: { name: packageManager.name, source: packageManager.source },
    ...(vacuous
      ? {
          vacuousReason: hasManifest
            ? "ningun paso del veredicto esta declarado en package.json: no se verifico nada"
            : "el repo no tiene package.json, asi que ningun validator pudo ejecutarse: no se verifico nada"
        }
      : {}),
    blockers,
    warnings,
    notConfigured,
    steps
  };

  if (write && slice && phase) {
    try {
      const evidenceDir = path.join(target, ".github", "agent-state", "evidence", slice);
      fs.mkdirSync(evidenceDir, { recursive: true });
      const artifactPath = path.join(evidenceDir, `${phase}-verdict.yaml`);
      const yaml = [
        `verdict: ${payload.verdict}`,
        `status: ${payload.status}`,
        `blockers: ${JSON.stringify(payload.blockers)}`,
        `warnings: ${JSON.stringify(payload.warnings)}`,
        `generatedAt: "${new Date().toISOString()}"`,
      ].join("\n");
      fs.writeFileSync(artifactPath, yaml + "\n", "utf8");
      payload.artifactPath = path.relative(target, artifactPath);
    } catch (err) {
      payload.writeError = err.message;
    }
  }

  return {
    exitCode: ready ? EXIT_OK : EXIT_ACTION_REQUIRED,
    payload
  };
}

// ---------------------------------------------------------------------------
// commandStatus (ADR-0006 / ADR-024 P2)
// Aggregates governance-check + tools-doctor + phase-gate into a single
// go/no-go snapshot. With --markdown --write, produces status.md.
// With --exit-code, returns non-zero if any component is error/blocked.
// ---------------------------------------------------------------------------

export function commandStatus(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const writeMd = Boolean(options.markdown && options.write);
  const exitCodeMode = Boolean(options["exit-code"] ?? options.exitCode);

  const govResult = commandGovernanceCheck(options);
  const toolsResult = commandToolsDoctor(options);

  // Phase gate: resolve phase/slice from phase-status.yaml if not provided
  let phaseGateResult = null;
  let phaseGateExitCode = EXIT_OK;
  const phaseStatusPath = path.join(target, ".github", "agent-state", "phase-status.yaml");
  const phaseFromOpts = options.phase ?? null;
  const sliceFromOpts = options.slice ?? null;
  let resolvedPhase = phaseFromOpts;
  let resolvedSlice = sliceFromOpts;
  const phaseStatus = readPhaseStatus(target);
  if (!resolvedPhase || !resolvedSlice) {
    resolvedPhase = resolvedPhase ?? phaseStatus.pointer.phase;
    resolvedSlice = resolvedSlice ?? phaseStatus.pointer.slice;
  }
  if (resolvedPhase && resolvedSlice) {
    const pgOptions = { ...options, phase: resolvedPhase, slice: resolvedSlice, "exit-code": true };
    const pgResult = commandPhaseGate(pgOptions);
    phaseGateResult = pgResult.payload;
    phaseGateExitCode = pgResult.exitCode;
  }

  // Cuarto componente: la calidad medida. Se adjudica desde la evidencia ya
  // escrita, sin ejecutar probes, porque `status` es una foto y no una medicion.
  // Un `no-configurado` no cuenta como fallo: la mayoria de consumidores todavia
  // no tiene contrato de calidad y no se les puede poner en no-go por eso.
  let qualityResult = null;
  if (resolvedPhase && resolvedSlice) {
    const adjudication = adjudicateFromEvidence(target, { slice: resolvedSlice, phase: resolvedPhase });
    qualityResult = {
      status: adjudication.status,
      code: adjudication.code ?? null,
      evaluated: adjudication.evaluated ?? [],
      violations: adjudication.violations ?? [],
      vacuous: adjudication.vacuous ?? [],
      findings: adjudication.findings ?? [],
      evidenceSource: adjudication.evidenceSource ?? null,
      // `advisory` sale del entorno REAL de este proceso, no de
      // `quality_metrics.source`. Ese campo lo redacta el evaluado en un YAML
      // que el guard de frontera no protege, asi que usarlo aqui permitia
      // presentar una medicion 100% local como autoritativa (`advisory: false`)
      // cambiando una palabra. Un veredicto solo puede dejar de ser advisory si
      // quien lo emite puede atestiguarlo: fuera de un runner, nadie puede.
      advisory: !detectCiEnvironment().isCi || adjudication.evidenceSource !== "ci",
      evidenceSourceVerified: detectCiEnvironment().isCi && adjudication.evidenceSource === "ci"
    };
  }

  // Estado de CADA slice declarado. El puntero decide el veredicto, pero un
  // slice en vuelo que nadie mira es un slice que puede llegar a merge sin que
  // su fase lo permita: por eso se adjudica tambien, y se reporta aparte.
  const otherSlices = phaseStatus.slices.map((slice) => {
    if (!slice.id || !slice.phase) {
      return { ...slice, phaseGate: { status: "skipped", message: "el slice no declara fase" } };
    }
    if (slice.id === resolvedSlice && slice.phase === resolvedPhase && phaseGateResult) {
      return { ...slice, phaseGate: { exitCode: phaseGateExitCode, status: phaseGateResult.status ?? null } };
    }
    const result = commandPhaseGate({ ...options, phase: slice.phase, slice: slice.id, "exit-code": true });
    return { ...slice, phaseGate: { exitCode: result.exitCode, status: result.payload?.status ?? null, blockers: result.payload?.blockers ?? undefined } };
  });

  const govOk = govResult.exitCode === EXIT_OK;
  const toolsOk = toolsResult.exitCode === EXIT_OK;
  const phaseOk = phaseGateResult === null || phaseGateExitCode === EXIT_OK;
  const qualityOk =
    qualityResult === null ||
    qualityResult.status === "ok" ||
    qualityResult.status === "warning" ||
    qualityResult.status === "not-configured" ||
    qualityResult.status === "no-evidence";
  const ready = govOk && toolsOk && phaseOk && qualityOk;

  const payload = {
    ready,
    status: ready ? "go" : "no-go",
    governance: { exitCode: govResult.exitCode, ...govResult.payload },
    tools: { exitCode: toolsResult.exitCode, ...toolsResult.payload },
    phaseGate: phaseGateResult
      ? { exitCode: phaseGateExitCode, phase: resolvedPhase, slice: resolvedSlice, ...phaseGateResult }
      : { exitCode: EXIT_OK, status: "skipped", message: "No se resolvio phase/slice" },
    quality: qualityResult ?? { status: "skipped", message: "No se resolvio phase/slice" },
    // Todos los slices declarados, no solo el apuntado. `ready` sigue saliendo
    // del puntero: esto informa sin cambiar el veredicto, que es lo que permite
    // que sea aditivo y no rompa a nadie al actualizar.
    slices: otherSlices
  };

  if (writeMd) {
    const govStatus = govOk ? "✅ OK" : "❌ ERROR";
    const toolsStatus = toolsOk ? "✅ OK" : "⚠️ WARNINGS";
    const phaseStatus = phaseOk ? "✅ OK" : "🔴 BLOCKED";
    const qualityLabel =
      qualityResult === null
        ? "➖ n/a"
        : qualityResult.status === "not-configured"
          ? "➖ sin contrato"
          : qualityResult.status === "no-evidence"
            ? "➖ sin evidencia"
            : qualityResult.status === "blocked"
              ? "🔴 BLOCKED"
              : qualityResult.status === "warning"
                ? "⚠️ WARNINGS"
                : "✅ OK";
    // Un veredicto de calidad calculado en local no es autoritativo: se dice.
    const qualityStatus = qualityResult?.advisory && qualityResult.evaluated?.length > 0
      ? `${qualityLabel} (advisory)`
      : qualityLabel;
    const readinessLine = ready ? "## ✅ GO — Governance ready" : "## ❌ NO-GO — Governance not ready";
    const lines = [
      `# Governance Status — ${new Date().toISOString()}`,
      "",
      readinessLine,
      "",
      `| Component | Status |`,
      `|---|---|`,
      `| governance-check | ${govStatus} |`,
      `| tools-doctor | ${toolsStatus} |`,
      `| phase-gate (${resolvedPhase ?? "?"}/${resolvedSlice ?? "?"}) | ${phaseStatus} |`,
      `| quality | ${qualityStatus} |`,
      "",
      ...(otherSlices.length > 1
        ? [
            "## Slices declarados",
            "",
            "El veredicto de arriba sale del puntero. Estos son todos los slices que",
            "`phase-status.yaml` declara, con su phase-gate adjudicado por separado.",
            "",
            "| slice | fase | phase-gate | puntero |",
            "|---|---|---|---|",
            ...otherSlices.map(
              (slice) =>
                `| ${slice.id} | ${slice.phase ?? "?"} | ${slice.phaseGate?.status ?? "?"} | ${slice.isPointer ? "sí" : ""} |`
            ),
            ""
          ]
        : []),
      "## Details",
      "",
      `### governance-check`,
      "```json",
      JSON.stringify(govResult.payload, null, 2),
      "```",
      "",
      `### tools-doctor`,
      "```json",
      JSON.stringify(toolsResult.payload, null, 2),
      "```",
    ];
    if (phaseGateResult) {
      lines.push("", "### phase-gate", "```json", JSON.stringify(phaseGateResult, null, 2), "```");
    }
    if (qualityResult) {
      lines.push("", "### quality", "```json", JSON.stringify(qualityResult, null, 2), "```");
    }
    const md = lines.join("\n") + "\n";
    try {
      fs.writeFileSync(path.join(target, "status.md"), md, "utf8");
      payload.statusMdPath = "status.md";
    } catch (err) {
      payload.writeError = err.message;
    }
  }

  return {
    exitCode: exitCodeMode && !ready ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload
  };
}

function extractSharedRules(content) {
  const pattern = /<!-- SDLC_SHARED_RULES_START sha256:([a-f0-9]+) -->\n([\s\S]*?)\n<!-- SDLC_SHARED_RULES_END -->/;
  const match = pattern.exec(normalize(content));
  if (!match) return null;
  const body = normalize(match[2]);
  return {
    declaredHash: match[1],
    body,
    actualHash: sha256Text(body)
  };
}

function listSkillNames(root) {
  if (!pathExists(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && pathExists(path.join(root, entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

export function commandGovernanceCheck(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const findings = [];
  const sharedFiles = [
    "AGENTS.md",
    "CLAUDE.md",
    ".github/AGENTS.md",
    ".github/copilot-instructions.md"
  ];
  const blocks = [];
  for (const relativePath of sharedFiles) {
    const absolute = path.join(target, relativePath);
    const content = readTextIfExists(absolute);
    if (!content) {
      findings.push({ level: "error", code: "shared-rules-file-missing", path: relativePath });
      continue;
    }
    const block = extractSharedRules(content);
    if (!block) {
      findings.push({ level: "error", code: "shared-rules-block-missing", path: relativePath });
      continue;
    }
    if (block.declaredHash !== block.actualHash) {
      findings.push({
        level: "error",
        code: "shared-rules-hash-mismatch",
        path: relativePath,
        declared: block.declaredHash,
        actual: block.actualHash
      });
    }
    blocks.push({ path: relativePath, ...block });
  }
  const uniqueBodies = new Set(blocks.map((block) => block.actualHash));
  if (uniqueBodies.size > 1) {
    findings.push({ level: "error", code: "shared-rules-drift", hashes: [...uniqueBodies] });
  }

  const canonicalRoot = path.join(target, ".github", "skills");
  const canonicalSkills = listSkillNames(canonicalRoot);
  for (const mirrorRoot of [".claude/skills", ".agents/skills", ".windsurf/skills"]) {
    for (const skillName of canonicalSkills) {
      const mirrorPath = path.join(target, mirrorRoot, skillName, "SKILL.md");
      if (!pathExists(mirrorPath)) {
        findings.push({ level: "error", code: "skill-mirror-missing", path: `${mirrorRoot}/${skillName}/SKILL.md` });
        continue;
      }
      const mirror = readTextIfExists(mirrorPath) ?? "";
      if (!mirror.includes(`source: .github/skills/${skillName}/SKILL.md`)) {
        findings.push({ level: "warning", code: "skill-mirror-source-missing", path: `${mirrorRoot}/${skillName}/SKILL.md` });
      }
    }
  }

  const copilot = readTextIfExists(path.join(target, ".github", "copilot-instructions.md")) ?? "";
  for (const [test, code] of [
    [(text) => text.includes("feature/"), "copilot-branch-flow-missing"],
    [(text) => text.includes("gate humano") || text.includes("gates humanos"), "copilot-human-gate-missing"],
    [(text) => text.includes(".github/skills"), "copilot-skills-source-missing"]
  ]) {
    if (!test(copilot.toLowerCase())) {
      findings.push({ level: "error", code, path: ".github/copilot-instructions.md" });
    }
  }

  const hasErrors = findings.some((finding) => finding.level === "error");
  const hasWarnings = findings.some((finding) => finding.level === "warning");
  return {
    exitCode: hasErrors ? EXIT_ERROR : hasWarnings ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: hasErrors ? "error" : hasWarnings ? "warning" : "ok",
      sharedRulesHash: blocks[0]?.actualHash ?? null,
      canonicalSkills: canonicalSkills.length,
      findings
    }
  };
}

/**
 * Lee `.github/agent-state/phase-status.yaml`.
 *
 * `current_slice`/`current_phase` son un puntero UNICO, y el arbitro lo lee
 * para decidir que evalua. Con varios slices en vuelo —tres a la vez en
 * manga-translator-mvp— eso significa que se evalua uno y los demas quedan
 * invisibles: no fallan, no aparecen, no existen para el tablero.
 *
 * El mapa `slices:` es ADITIVO: el puntero se conserva tal cual (los workflows
 * de los consumidores lo grepean y no se rompen), y quien declare el mapa
 * obtiene ademas el estado de cada slice. Sin mapa, se deriva una entrada del
 * propio puntero, asi que un phase-status antiguo se comporta igual que antes.
 *
 * @returns {{pointer: {slice: string|null, phase: string|null}, slices: Array, declared: boolean, parsed: boolean}}
 */
export function readPhaseStatus(target) {
  const raw = readTextIfExists(path.join(target, ".github", "agent-state", "phase-status.yaml"));
  const empty = { pointer: { slice: null, phase: null }, slices: [], declared: false, parsed: false };
  if (!raw) return empty;

  let doc = null;
  try {
    doc = YAML.parse(raw);
  } catch {
    // YAML roto: se cae al parseo por lineas que se usaba antes, para no
    // perder el puntero por un error en una parte del archivo que no importa.
    const pointer = { slice: null, phase: null };
    for (const line of raw.split("\n")) {
      const mp = line.match(/^\s*current_phase:\s*"?([^"\r\n]+?)"?\s*$/);
      const ms = line.match(/^\s*current_slice:\s*"?([^"\r\n]+?)"?\s*$/);
      if (mp) pointer.phase = pointer.phase ?? mp[1].trim();
      if (ms) pointer.slice = pointer.slice ?? ms[1].trim();
    }
    return { pointer, slices: pointer.slice ? [{ id: pointer.slice, phase: pointer.phase, isPointer: true }] : [], declared: false, parsed: false };
  }

  const pointer = {
    slice: doc?.current_slice ? String(doc.current_slice).trim() : null,
    phase: doc?.current_phase ? String(doc.current_phase).trim() : null
  };
  const declaredMap = doc?.slices && typeof doc.slices === "object" && !Array.isArray(doc.slices) ? doc.slices : null;
  if (!declaredMap) {
    return {
      pointer,
      slices: pointer.slice ? [{ id: pointer.slice, phase: pointer.phase, isPointer: true, phasesCompleted: doc?.phases_completed ?? [] }] : [],
      declared: false,
      parsed: true
    };
  }

  const slices = Object.entries(declaredMap).map(([id, value]) => ({
    id,
    phase: value?.phase ? String(value.phase).trim() : null,
    phaseName: value?.phase_name ?? null,
    phasesCompleted: value?.phases_completed ?? [],
    isPointer: id === pointer.slice
  }));
  // El puntero apunta a un slice que el mapa no declara: el tablero y el mapa
  // se contradicen y hay que decirlo, no elegir uno en silencio.
  if (pointer.slice && !slices.some((slice) => slice.id === pointer.slice)) {
    slices.push({ id: pointer.slice, phase: pointer.phase, isPointer: true, phasesCompleted: [], unlisted: true });
  }
  return { pointer, slices, declared: true, parsed: true };
}

function checkTool(name, probe) {
  const result = probe();
  return { name, ...result };
}

export function commandToolsDoctor(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const profile = options.profile ?? "default";
  const home = os.homedir();
  const claudeSettings = readTextIfExists(path.join(home, ".claude", "settings.json")) ?? "";
  const packageManager = detectPackageManager(target);
  const tools = [
    checkTool("package-manager", () => {
      const [command, args] = packageManager.versionCommand;
      const result = runCommand(command, args, target, 10_000);
      // Que el binario responda no dice nada si el repo no tiene proyecto Node:
      // se reportaba `ok` en un repo SIN package.json, porque se cae al default
      // `pnpm` y `pnpm --version` funciona en la maquina. "El gestor anda" y
      // "hay algo que gestionar" son dos cosas distintas, y el harness necesita
      // la segunda para poder correr un solo validator.
      // Se reporta como `ok` a proposito: el gestor SI esta disponible, que es
      // lo que este check mide. Escalarlo a warning lo convertia en error —
      // `package-manager` es required— y dejaba en rojo el doctor de cualquier
      // consumidor que no sea Node, que es un estado legitimo.
      //
      // La consecuencia real (ningun validator puede correr) la reporta
      // `sdlc verdict` como NOT-VERIFIABLE, que es donde importa. Aqui basta
      // con no dejar el `ok` desnudo, porque "el gestor anda" y "hay algo que
      // gestionar" son cosas distintas.
      const hasManifest = readPackageScripts(target) !== null;
      if (result.ok && !hasManifest) {
        return {
          status: "ok",
          manager: packageManager.name,
          detectedFrom: packageManager.source,
          version: firstLine(result.stdout || result.stderr),
          detail: `${packageManager.name} responde, pero el repo no tiene package.json: ningun script validate:* puede ejecutarse (ver \`sdlc verdict\`).`
        };
      }
      return {
        status: result.ok ? "ok" : "missing",
        manager: packageManager.name,
        detectedFrom: packageManager.source,
        version: firstLine(result.stdout || result.stderr)
      };
    }),
    checkTool("openspec", () => ({
      status: pathExists(path.join(target, "openspec", "config.yaml")) ? "ok" : "missing",
      path: "openspec/config.yaml"
    })),
    checkTool("graphify", () => ({
      status: pathExists(path.join(target, "graphify-out", "graph.json")) ? "ok" : "warning",
      path: "graphify-out/graph.json"
    })),
    checkTool("codegraph", () => {
      const result = runCommand("codegraph", ["status"], target, 12_000);
      return { status: result.ok ? "ok" : "warning", detail: firstLine(result.stdout || result.stderr) };
    }),
    checkTool("obsidian-memory", () => ({
      status: pathExists(path.join(target, "scripts", "obsidian-memory.config.local.json")) || pathExists(path.join(target, "scripts", "obsidian-memory.config.example.json")) ? "ok" : "warning",
      path: "scripts/obsidian-memory.config.local.json"
    })),
    checkTool("headroom", () => ({
      status: /headroom\s+init\s+hook\s+ensure/i.test(claudeSettings) ? "ok" : "warning",
      hook: /headroom\s+init\s+hook\s+ensure/i.test(claudeSettings)
    })),
    checkTool("caveman", () => ({
      status: /caveman-activate\.js/i.test(claudeSettings) ? "ok" : "warning",
      hook: /caveman-activate\.js/i.test(claudeSettings)
    })),
    checkTool("autoskills", () => ({
      status: pathExists(path.join(target, "scripts", "agent-skills.manifest.json")) ? "ok" : "missing",
      path: "scripts/agent-skills.manifest.json"
    })),
    checkTool("party-mode", () => ({
      status: pathExists(path.join(target, ".github", "skills", "party-mode", "SKILL.md")) ? "ok" : "missing",
      path: ".github/skills/party-mode/SKILL.md"
    })),
    // Preparacion para firmar (P5). Sin esto, un consumidor descubre que no
    // puede atestar NADA en el momento en que un gate humano se lo pide, con la
    // fase ya bloqueada: es lo que paso en manga-translator-mvp, donde
    // `governance.maintainers` no existia y ningun commit de la historia estaba
    // firmado (%G? = N en todos). Todo lo que se comprueba aqui es local y
    // barato; no se firma nada de prueba.
    checkTool("commit-signing", () => {
      const rawConfig = readTextIfExists(path.join(target, ".sdlc", "config.json"));
      let maintainers = [];
      if (rawConfig) {
        try {
          maintainers = JSON.parse(rawConfig).governance?.maintainers ?? [];
        } catch {
          return { status: "warning", detail: ".sdlc/config.json ilegible: no se puede saber quien puede firmar." };
        }
      }
      const gitConfig = (key) => firstLine(runCommand("git", ["config", "--get", key], target, 5_000).stdout ?? "");
      const format = gitConfig("gpg.format") || "openpgp";
      const signingKey = gitConfig("user.signingkey");
      const allowedSigners = format === "ssh" ? gitConfig("gpg.ssh.allowedSignersFile") : null;

      const missing = [];
      if (maintainers.length === 0) {
        missing.push("config.governance.maintainers esta vacio: `sdlc signoff --verify` aborta antes de mirar la firma");
      }
      if (!signingKey) {
        missing.push("git config user.signingkey sin valor: `sdlc signoff --create` no puede firmar");
      }
      if (format === "ssh" && !allowedSigners) {
        missing.push("gpg.format=ssh sin gpg.ssh.allowedSignersFile: `git verify-commit` rechaza cualquier firma");
      }
      if (format === "ssh" && allowedSigners && !pathExists(allowedSigners)) {
        missing.push(`gpg.ssh.allowedSignersFile apunta a ${allowedSigners}, que no existe`);
      }
      // El formato de `%GS` depende del backend, y declarar el maintainer en la
      // forma del otro backend es el error que mas cuesta diagnosticar.
      const hint =
        format === "ssh"
          ? "Con SSH, git reporta como firmante el PRINCIPAL de allowed_signers (normalmente el email solo)."
          : "Con GPG, git reporta como firmante el UID completo (\"Nombre <email>\").";

      return missing.length > 0
        ? { status: "warning", format, signingKey: Boolean(signingKey), maintainers: maintainers.length, detail: `${missing.join("; ")}. ${hint}` }
        : { status: "ok", format, maintainers: maintainers.length, detail: hint };
    }),
    // Un script de gate que resuelve `@latest` en cada corrida no es
    // reproducible (cambia de comportamiento cuando publican) y paga red cada
    // vez. Medido en un consumidor real: `npx @fission-ai/openspec@latest` era
    // 9.1 de los 9.3 segundos de `sdlc verdict`.
    checkTool("pinned-tooling", () => {
      const raw = readTextIfExists(path.join(target, "package.json"));
      if (!raw) return { status: "ok", detail: "sin package.json" };
      let scripts = {};
      try {
        scripts = JSON.parse(raw).scripts ?? {};
      } catch {
        return { status: "warning", detail: "package.json ilegible" };
      }
      const floating = Object.entries(scripts)
        .filter(([, body]) => typeof body === "string" && /npx\s+(-y\s+|--yes\s+)?[^\s|&]*@latest/.test(body))
        .map(([name]) => name);
      return floating.length > 0
        ? {
            status: "warning",
            floatingScripts: floating,
            detail: `Scripts que resuelven @latest en cada corrida: ${floating.join(", ")}. Fijar la version como devDependency.`
          }
        : { status: "ok" };
    })
  ];
  const required =
    profile === "full"
      ? new Set(["package-manager", "openspec", "autoskills", "party-mode"])
      : new Set(["package-manager"]);
  // La deteccion no cambia; lo que cambia es que el hallazgo ahora dice QUE
  // ES la herramienta y COMO conseguirla. Antes `tool-graphify: warning` con
  // una ruta era todo lo que el usuario recibia: sin forma de saber si esa
  // "opcional" le hacia falta ni donde buscarla. El inventario
  // (external-tools.yaml) es la fuente unica de esa informacion.
  const described = describeTools(target);
  const findings = tools
    .filter((tool) => tool.status !== "ok")
    .map((tool) => {
      const meta = described.ok ? described.byId.get(tool.name) : null;
      return {
        level: required.has(tool.name) ? "error" : "warning",
        code: `tool-${tool.name}`,
        message: `${tool.name}: ${tool.status}`,
        // El `detail` que produjo el propio probe: es lo unico que dice QUE
        // falta en ESTE repo. El inventario describe la herramienta en general;
        // no puede decir que a este consumidor le falta allowed_signers.
        ...(tool.detail ? { detail: tool.detail } : {}),
        ...(meta
          ? {
              purpose: meta.purpose,
              required: meta.required,
              profile: meta.profile,
              // `install` cuando se puede automatizar; `manual` cuando el paso
              // es de una persona. Distinguirlos importa: prometer un comando
              // que no existe es peor que decir "esto lo haces tu".
              ...(meta.install ? { install: meta.install } : {}),
              ...(meta.manual ? { manual: meta.manual } : {}),
              ...(meta.docs ? { docs: meta.docs } : {}),
              hint: meta.install
                ? `sdlc tools-install --tool ${tool.name} --apply`
                : "requiere un paso manual (ver 'manual')"
            }
          : {})
      };
    });
  const hasErrors = findings.some((finding) => finding.level === "error");
  const hasWarnings = findings.some((finding) => finding.level === "warning");
  return {
    exitCode: hasErrors ? EXIT_ERROR : hasWarnings ? EXIT_ACTION_REQUIRED : EXIT_OK,
    payload: {
      status: hasErrors ? "error" : hasWarnings ? "warning" : "ok",
      profile,
      target,
      packageManager: { name: packageManager.name, source: packageManager.source },
      tools,
      findings
    }
  };
}

export function commandPrBodyCheck(options) {
  const target = path.resolve(options.repo ?? options.target ?? process.cwd());
  const pr = options.pr;
  if (!pr) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: "Falta --pr <number>." } };
  }
  const result = runCommand("gh", ["pr", "view", String(pr), "--json", "body", "--jq", ".body | length"], target, 20_000);
  if (!result.ok) {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: "No se pudo leer el PR con gh.", stderr: result.stderr }
    };
  }
  const length = Number(result.stdout);
  return {
    exitCode: length > 0 ? EXIT_OK : EXIT_ACTION_REQUIRED,
    payload: {
      status: length > 0 ? "ok" : "blocked",
      pr: Number(pr),
      bodyLength: Number.isFinite(length) ? length : 0
    }
  };
}
