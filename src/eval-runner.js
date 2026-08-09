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
    // `train` por defecto: una tarea sin declarar no puede colarse como
    // validacion held-out. El held-out se declara, no se asume.
    split: task.split === "val" ? "val" : "train",
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

  // SkillOpt (microsoft/SkillOpt) acepta una edicion solo cuando mejora
  // ESTRICTAMENTE un score de VALIDACION HELD-OUT. Ese "held-out" no es un
  // detalle: si la edicion se deriva de las mismas tareas contra las que se
  // valida, el gate se esta midiendo a si mismo — puede pasar por haber
  // memorizado el conjunto, no por haber mejorado. Es un control que no puede
  // fallar por la razon correcta.
  //
  // Aqui las tareas declaran `split: train|val`. Sin `val` no hay held-out, y
  // en ese caso el gate se reporta VACUO en vez de dar un numero que parece
  // una validacion.
  const scored = allResults.filter(r => !r.error && Array.isArray(r.tasks) && r.tasks.length > 0);
  const weigh = (tasks) => tasks.reduce(
    (acc, task) => {
      const weight = task.weight ?? 1;
      acc.totalWeight += weight;
      if (task.pass) acc.passedWeight += weight;
      return acc;
    },
    { totalWeight: 0, passedWeight: 0 }
  );
  const ratio = ({ passedWeight, totalWeight }) => (totalWeight > 0 ? passedWeight / totalWeight : 0);

  const allTasks = scored.flatMap(r => r.tasks);
  const trainTasks = allTasks.filter(task => (task.split ?? "train") === "train");
  const valTasks = allTasks.filter(task => task.split === "val");

  const overallScore = weigh(allTasks);
  const score = ratio(overallScore);
  const trainWeighed = weigh(trainTasks);
  const valWeighed = weigh(valTasks);

  const heldOut = valTasks.length > 0;
  const payload = {
    status: "ok",
    skill: skillName,
    score,
    scorePercent: Math.round(score * 100),
    // ADVERTENCIA ESTRUCTURAL, no un detalle de implementacion.
    //
    // SkillOpt puntua ROLLOUTS: el agente ejecuta tareas y se mide su
    // comportamiento (`hard`/`soft` por trayectoria). Aqui no hay rollout:
    // `scoreTask` recibe el PROPIO documento de skill como si fuera la salida,
    // y comprueba si contiene ciertas cadenas. Como el optimizador edita ese
    // mismo documento, la recompensa es trivialmente jugable: reproducido,
    // pegar los `expected_fields` en el markdown lleva el score held-out de
    // 0% a 100% y aprueba el gate de mejora estricta sin ensenarle nada al
    // agente.
    //
    // Mientras eso siga asi, este score NO puede presentarse como validacion.
    // Se declara igual que `red-proof-verify` declara la suya: el numero es
    // real, lo que no es real es lo que parece demostrar.
    scoringMode: "document-presence",
    authoritative: false,
    limitations: [
      "no hay rollout: no se ejecuta al agente, se inspecciona el texto de la skill",
      "la recompensa es jugable por construccion — insertar los expected_fields en el documento sube el score sin cambiar comportamiento",
      "las fases Rollout y Reflect de SkillOpt no existen todavia; sin ellas Aggregate y Select no tienen que agregar ni que rankear"
    ],
    // El score que el gate debe leer es el de validacion, no el global.
    splits: {
      train: { tasks: trainTasks.length, score: ratio(trainWeighed), scorePercent: Math.round(ratio(trainWeighed) * 100) },
      val: { tasks: valTasks.length, score: ratio(valWeighed), scorePercent: Math.round(ratio(valWeighed) * 100) }
    },
    heldOut,
    // NO se emite `gateScorePercent` mientras la senal sea de presencia de
    // texto. Declarar que un numero no es autoritativo y entregarlo igual con
    // exit 0 es pedirle al consumidor que lea la letra chica: aguas abajo se
    // usa el numero, no la advertencia. Un control que no puede fallar por la
    // razon correcta no debe ofrecer la cifra con la que se aprueba.
    //
    // El score sigue publicandose para diagnostico (`score`, `splits`), pero
    // el campo que un gate leeria solo aparece cuando exista rollout real.
    ...(heldOut
      ? {
          gate: "not-authoritative",
          gateReason:
            "hay held-out, pero el score mide presencia de texto en el propio documento que se edita: no puede usarse para aprobar una edicion. Falta la fase Rollout (ejecutar al agente y puntuar su comportamiento)."
        }
      : {
          gate: "vacuous",
          gateReason:
            "ninguna tarea declara `split: val`: no hay conjunto held-out, asi que un score mejor puede venir de haber memorizado las mismas tareas que motivaron la edicion. Declarar tareas de validacion antes de usar este score como gate."
        }),
    evalSets: allResults,
    summary: heldOut
      ? `${skillName}: score ${Math.round(score * 100)}% global, ${Math.round(ratio(valWeighed) * 100)}% en validacion held-out (${valTasks.length} tareas)`
      : `${skillName}: score ${Math.round(score * 100)}% (${overallScore.passedWeight}/${overallScore.totalWeight}) — SIN held-out: el gate seria vacuo`
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
  // `learning_rate` en SkillOpt NO es un factor de escala: es el numero MAXIMO
  // de ediciones que un ciclo puede aplicar (su propia analogia es el gradient
  // clipping), y se aplica en la fase Select, que rankea y RECORTA. Nuestro
  // cap heredado de ADR-023 contaba secciones/archivos, que es otra cosa: diez
  // ediciones dentro de una misma seccion pasaban el cap y siguen siendo diez
  // ediciones. Se declaran los dos, porque acotan dimensiones distintas.
  const maxEdits = Number(options["learning-rate"] ?? options["max-edits"] ?? 5);
  const lrScheduler = String(options["lr-scheduler"] ?? "constant");

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
    `**Learning rate (max edits):** máximo ${maxEdits} ediciones \`add\`/\`delete\`/\`replace\` en este ciclo (scheduler: ${lrScheduler}).`,
    `Es el cap de SkillOpt y acota una dimensión distinta del blast-radius: diez ediciones dentro`,
    `de una misma sección pasan el cap de secciones y siguen siendo diez ediciones.`,
    ``,
    `## Instrucciones`,
    ``,
    `1. Editar la sección "Diff propuesto" con el cambio deseado.`,
    `2. Ejecutar \`sdlc skill-eval ${skillName}\` para obtener el score base del canónico.`,
    `3. Aplicar el diff localmente a una copia temporal y re-evaluar para obtener el score de la propuesta.`,
    `4. Completar la sección "Score" con ambos valores.`,
    `5. Someter el change al gate humano. La regla es MEJORA ESTRICTA sobre el conjunto held-out:`,
    `   apruébese solo si score_val_propuesta > score_val_base. No basta \`>=\`: un empate significa`,
    `   que la edición no demostró nada, y aceptarlo deja entrar cambios que no mejoran.`,
    `   Si el eval set no declara tareas \`split: val\`, NO hay held-out y el gate es vacuo:`,
    `   el score se estaría midiendo contra las mismas tareas que motivaron la edición.`,
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
