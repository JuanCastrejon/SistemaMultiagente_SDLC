import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { pathExists } from "./file-utils.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

function loadEvalSets(skillsDir, skillName) {
  const evalsDir = path.join(skillsDir, skillName, "evals");
  if (!pathExists(evalsDir)) return [];
  const sets = [];
  for (const entry of fs.readdirSync(evalsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".yaml")) continue;
    try {
      const raw = fs.readFileSync(path.join(evalsDir, entry.name), "utf8");
      const parsed = YAML.parse(raw);
      if (parsed && Array.isArray(parsed.tasks)) sets.push({ file: entry.name, ...parsed });
    } catch (err) {
      sets.push({ file: entry.name, error: err.message, tasks: [] });
    }
  }
  return sets;
}

function loadSkillContent(skillsDir, skillName) {
  const skillPath = path.join(skillsDir, skillName, "SKILL.md");
  if (!pathExists(skillPath)) return null;
  return fs.readFileSync(skillPath, "utf8");
}

// ---------------------------------------------------------------------------
// Scoring — deterministic (presence-based), P4 pilot
// ---------------------------------------------------------------------------

function scoreTask(task, skillContent) {
  const output = skillContent ?? "";
  const presentFields = [];
  const missingFields = [];
  const wronglyPresentFields = [];

  for (const field of task.expected_fields ?? []) {
    if (output.includes(field)) {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  for (const anti of task.expected_absent ?? []) {
    if (output.includes(anti)) wronglyPresentFields.push(anti);
  }

  const pass = missingFields.length === 0 && wronglyPresentFields.length === 0;
  return {
    id: task.id,
    description: task.description,
    pass,
    weight: task.weight ?? 1,
    presentFields,
    missingFields,
    wronglyPresentFields,
  };
}

function computeScore(results) {
  const total = results.reduce((sum, r) => sum + (r.weight ?? 1), 0);
  const passed = results.filter(r => r.pass).reduce((sum, r) => sum + (r.weight ?? 1), 0);
  return total > 0 ? passed / total : 0;
}

// ---------------------------------------------------------------------------
// commandSkillEval (ADR-0006 / ADR-025)
// ---------------------------------------------------------------------------

export function commandSkillEval(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const skillName = options.skill ?? options._positionals?.[1];
  if (!skillName) {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: "Falta --skill <nombre> o argumento posicional." }
    };
  }

  const skillsDir = path.join(target, ".github", "skills");
  const skillContent = loadSkillContent(skillsDir, skillName);
  if (!skillContent) {
    return {
      exitCode: EXIT_ERROR,
      payload: {
        status: "error",
        message: `Skill no encontrada: .github/skills/${skillName}/SKILL.md`,
      }
    };
  }

  const evalSets = loadEvalSets(skillsDir, skillName);
  if (evalSets.length === 0) {
    return {
      exitCode: EXIT_ACTION_REQUIRED,
      payload: {
        status: "no-evals",
        message: `No hay golden tasks en .github/skills/${skillName}/evals/. Crear al menos un archivo YAML con tasks[].`,
        skill: skillName,
      }
    };
  }

  const allResults = [];
  for (const evalSet of evalSets) {
    if (evalSet.error) {
      allResults.push({ file: evalSet.file, error: evalSet.error, tasks: [] });
      continue;
    }
    const taskResults = (evalSet.tasks ?? []).map(task => scoreTask(task, skillContent));
    allResults.push({
      file: evalSet.file,
      skill: evalSet.skill ?? skillName,
      version: evalSet.version,
      score: computeScore(taskResults),
      tasks: taskResults,
    });
  }

  const overallScore = allResults
    .filter(r => !r.error && Array.isArray(r.tasks) && r.tasks.length > 0)
    .reduce((acc, r) => {
      acc.totalWeight += r.tasks.reduce((s, t) => s + (t.weight ?? 1), 0);
      acc.passedWeight += r.tasks.filter(t => t.pass).reduce((s, t) => s + (t.weight ?? 1), 0);
      return acc;
    }, { totalWeight: 0, passedWeight: 0 });

  const score = overallScore.totalWeight > 0
    ? overallScore.passedWeight / overallScore.totalWeight
    : 0;

  const payload = {
    status: "ok",
    skill: skillName,
    score,
    scorePercent: Math.round(score * 100),
    evalSets: allResults,
    summary: `${skillName}: score ${Math.round(score * 100)}% (${overallScore.passedWeight}/${overallScore.totalWeight} weighted tasks passed)`,
  };

  return { exitCode: EXIT_OK, payload };
}

// ---------------------------------------------------------------------------
// commandSkillPropose (ADR-0006 / ADR-025)
// Writes a proposal ONLY under openspec/changes/<change>/proposed-skill-diff.md.
// NEVER touches .github/skills/ directly — the hook deny in P1 would block it anyway.
// ---------------------------------------------------------------------------

export function commandSkillPropose(options) {
  const target = path.resolve(options.target ?? process.cwd());
  const skillName = options.skill ?? options._positionals?.[1];
  const changeName = options.change ?? options._positionals?.[2];
  const intent = options.intent ?? options.message ?? "";
  const blastRadiusCap = Number(options["blast-radius"] ?? 3);

  if (!skillName || !changeName) {
    return {
      exitCode: EXIT_ERROR,
      payload: {
        status: "error",
        message: "Falta --skill <nombre> y/o --change <change>. Uso: sdlc skill-propose --skill <skill> --change <change> --intent \"<descripcion>\"",
      }
    };
  }

  // Guard: do not allow writing to .github/skills/ (belt-and-suspenders; hook deny is the primary)
  const skillsDir = path.join(target, ".github", "skills");
  const canonicalPath = path.join(skillsDir, skillName, "SKILL.md");
  const changesDir = path.join(target, "openspec", "changes", changeName);
  const proposalPath = path.join(changesDir, "proposed-skill-diff.md");
  const evalReportPath = path.join(changesDir, "skill-eval-report.yaml");

  const skillContent = pathExists(canonicalPath) ? fs.readFileSync(canonicalPath, "utf8") : null;
  if (!skillContent) {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: `Skill canónica no encontrada: .github/skills/${skillName}/SKILL.md` }
    };
  }

  // Ensure change directory exists
  try {
    fs.mkdirSync(changesDir, { recursive: true });
  } catch (err) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: `No se pudo crear ${changesDir}: ${err.message}` } };
  }

  // Write proposal template (human fills in the actual diff)
  const lines = [
    `# Propuesta de edición de skill: ${skillName}`,
    ``,
    `**Change:** \`${changeName}\``,
    `**Skill canónica:** \`.github/skills/${skillName}/SKILL.md\``,
    `**Intención:** ${intent || "(describir el objetivo del cambio)"}`,
    `**Blast-radius cap:** máximo ${blastRadiusCap} secciones`,
    ``,
    `## Instrucciones`,
    ``,
    `1. Editar la sección "Diff propuesto" con el cambio deseado.`,
    `2. Ejecutar \`sdlc skill-eval ${skillName}\` para obtener el score base del canónico.`,
    `3. Aplicar el diff localmente a una copia temporal y re-evaluar para obtener el score de la propuesta.`,
    `4. Completar la sección "Score" con ambos valores.`,
    `5. Someter el change al gate humano: el validador aprueba si score_propuesta >= score_base (no-regresión).`,
    `6. NUNCA editar \`.github/skills/${skillName}/SKILL.md\` directamente; solo via este change.`,
    ``,
    `## Diff propuesto`,
    ``,
    `\`\`\`diff`,
    `# Pegar aquí el diff unificado vs el canónico actual`,
    `\`\`\``,
    ``,
    `## Score`,
    ``,
    `| Versión | Score |`,
    `|---|---|`,
    `| Canónica actual | (ejecutar sdlc skill-eval ${skillName}) |`,
    `| Propuesta | (ejecutar después de aplicar el diff) |`,
    ``,
    `## Razón del cambio`,
    ``,
    `(Describir qué comportamiento del agente se espera mejorar y por qué)`,
    ``,
    `## Anti-patrones a evitar (consultar rejected-proposals.md)`,
    ``,
    `(Listar anti-patrones del ledger que aplican a este cambio)`,
  ];

  try {
    fs.writeFileSync(proposalPath, lines.join("\n") + "\n", "utf8");
  } catch (err) {
    return { exitCode: EXIT_ERROR, payload: { status: "error", message: `No se pudo escribir la propuesta: ${err.message}` } };
  }

  // Write eval report stub for the canonical score
  const evalResult = commandSkillEval({ target, skill: skillName });
  const evalStub = [
    `skill: ${skillName}`,
    `change: ${changeName}`,
    `canonical_score: ${evalResult.payload.scorePercent ?? "N/A"}`,
    `proposal_score: null`,
    `non_regression: null`,
    `generated_at: "${new Date().toISOString()}"`,
  ].join("\n");
  try {
    fs.writeFileSync(evalReportPath, evalStub + "\n", "utf8");
  } catch { /* non-fatal */ }

  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      skill: skillName,
      change: changeName,
      proposalPath: path.relative(target, proposalPath),
      evalReportPath: path.relative(target, evalReportPath),
      canonicalScore: evalResult.payload.scorePercent ?? "N/A",
      message: `Propuesta creada en ${path.relative(target, proposalPath)}. Completar diff y verificar no-regresión antes del gate humano.`,
    }
  };
}
