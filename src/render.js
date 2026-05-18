import path from "node:path";

export const FRAMEWORK_VERSION = "1.0.0";
export const SCHEMA_VERSION = 1;
export const SUPPORTED_MODES = new Set(["greenfield", "legacy"]);

export function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proyecto";
}

export function defaultConfig({ target, mode = "greenfield", projectName, projectSlug }) {
  const resolvedProjectName = projectName || path.basename(path.resolve(target));
  const resolvedSlug = projectSlug || slugify(resolvedProjectName);
  return {
    $schema: "./schemas/sdlc.config.schema.json",
    schemaVersion: SCHEMA_VERSION,
    frameworkVersion: FRAMEWORK_VERSION,
    project: {
      name: resolvedProjectName,
      slug: resolvedSlug,
      organization: "example-org"
    },
    mode,
    stack: {
      backend: "<BACKEND_STACK>",
      frontend: "<FRONTEND_STACK>",
      mobile: "<MOBILE_STACK>"
    },
    surfaces: [
      {
        id: "backend",
        path: "apps/api",
        owner: "api-agent"
      },
      {
        id: "web",
        path: "apps/web",
        owner: "web-agent"
      }
    ],
    agents: {
      controlPlane: ["planificador-opus", "orquestador-opus"],
      specialistPlane: ["analista-requisitos", "arquitecto", "api-agent", "web-agent", "qa-security-review"]
    },
    gitFlow: {
      integrationBranch: "develop",
      stableBranch: "main",
      branchPrefixes: ["feature/", "fix/", "docs/"]
    },
    readiness: {
      defaultLevel: "L2",
      levels: ["L1", "L2", "L3"]
    },
    openspec: {
      profile: "expanded",
      customProfile: null
    },
    graphify: {
      enabled: true,
      scope: ["docs/", "openspec/", ".github/agents/", ".github/skills/", ".github/agent-state/", "AGENTS.md", "indice-operativo.md"]
    },
    obsidian: {
      enabled: true,
      vaultPath: "${VAULT_PATH}",
      memoryWorkspace: "${MEMORY_WORKSPACE}"
    },
    backup: {
      keepLast: 5
    },
    externalSkills: {
      allowlist: "core/skills/external-allowlist.yaml",
      protected: "core/skills/protected.yaml",
      overrides: []
    }
  };
}

export function validateConfigShape(config) {
  const errors = [];
  if (!config || typeof config !== "object") errors.push("config debe ser un objeto");
  if (config.schemaVersion !== SCHEMA_VERSION) errors.push(`schemaVersion debe ser ${SCHEMA_VERSION}`);
  if (!config.frameworkVersion) errors.push("frameworkVersion es obligatorio");
  if (!config.project?.name) errors.push("project.name es obligatorio");
  if (!config.project?.slug) errors.push("project.slug es obligatorio");
  if (!SUPPORTED_MODES.has(config.mode)) errors.push("mode debe ser greenfield o legacy");
  if (!Array.isArray(config.surfaces)) errors.push("surfaces debe ser un arreglo");
  if (!config.gitFlow?.integrationBranch) errors.push("gitFlow.integrationBranch es obligatorio");
  if (!config.openspec?.profile) errors.push("openspec.profile es obligatorio");
  if (config.openspec?.profile === "custom") {
    if (!config.openspec.customProfile?.name) errors.push("openspec.customProfile.name es obligatorio para profile custom");
    if (!Array.isArray(config.openspec.customProfile?.workflows) || config.openspec.customProfile.workflows.length === 0) {
      errors.push("openspec.customProfile.workflows debe tener al menos un workflow");
    }
  }
  return errors;
}

function yamlList(values, indent = "    ") {
  return values.map((value) => `${indent}- ${value}`).join("\n");
}

function renderOpenSpecConfig(config) {
  const schema = config.mode === "legacy" ? "legacy-brownfield-sdd" : "greenfield-sdd";
  const sourceText = config.mode === "legacy"
    ? "Declarar fuente primaria, fuente secundaria, evidencia revisada, drift y AS-IS/TO-BE antes de proponer cambios funcionales."
    : "Investigar primero en docs, specs y backlog antes de proponer una capacidad nueva.";
  return `schema: ${schema}

context: |
  Proyecto ${config.mode} gobernado por SistemaMultiagente_SDLC.
  La fuente normativa vive en AGENTS.md, .github/, docs/ y openspec/.
  Todo artefacto OpenSpec se escribe en espanol.
  Los identificadores de capacidades y carpetas permanecen en kebab-case en ingles.
  Git flow: ${config.gitFlow.integrationBranch} -> ${config.gitFlow.stableBranch} mediante PR.

rules:
  research:
    - ${sourceText}
    - Separar hallazgos confirmados, inferencias y vacios abiertos.
    - Declarar objetivo de negocio, KPI principal, readiness L1/L2/L3 y matriz NFR en cambios funcionales no triviales.
  proposal:
    - Mantener el change acotado a capacidades trazables.
    - Declarar impacto operacional, exclusiones, dependencias y rollback cuando aplique.
  specs:
    - Usar escenarios Given/When/Then y describir comportamiento observable.
    - No inventar comportamiento sin evidencia.
  design:
    - Explicar trade-offs, secuencia entre superficies, riesgos y observabilidad.
  tasks:
    - Descomponer en slices pequenos, verificables y con validaciones explicitas.
`;
}

function renderPhaseGraph() {
  const phases = [
    "F0 Bootstrap",
    "F1 Analisis requisitos",
    "F2 Revision humana del borrador",
    "F3 Issue local y validacion",
    "F3.5 Branch desde integracion",
    "F4 Handoff readiness-gate",
    "F5 Planificacion SDD",
    "F6 Handoff planificador-orquestador",
    "F7 Orquestacion",
    "F8 Implementacion",
    "F9 QA tests",
    "F10 Security review",
    "F11 Commit y push",
    "F12 Pull request",
    "F13 Gate humano final",
    "F14 Merge a integracion",
    "F15 Verify post-merge",
    "F16 Archive",
    "F17 Doc viva y publish trace"
  ];
  return `version: 1
updated: 2026-05-18
max_rework_attempts_per_phase: 2
phases:
${phases.map((phase, index) => {
  const id = phase.split(" ")[0].replace(".", "_");
  const next = index < phases.length - 1 ? phases[index + 1].split(" ")[0].replace(".", "_") : "";
  return `  ${id}:\n    name: "${phase.substring(phase.indexOf(" ") + 1)}"\n    forward: [${next}]\n    rework: {}`;
}).join("\n")}
rework_labels:
  rework:F8:code-level:
    target: F8
    auto: true
  rework:F5:contract:
    target: F5
    auto: false
  rework:F10:security-re-scan:
    target: F10
    auto: true
`;
}

export function buildManagedFiles(config) {
  const project = config.project;
  const surfaces = config.surfaces.map((surface) => `| \`${surface.id}\` | \`${surface.path}\` | \`${surface.owner}\` |`).join("\n");
  const generatedAt = "generated-by-sdlc";
  const files = {
    ".sdlc/config.json": `${JSON.stringify(config, null, 2)}\n`,
    ".sdlc/README.md": `# SistemaMultiagente_SDLC\n\nInstalacion gestionada para ${project.name}.\n\n- Framework: ${config.frameworkVersion}\n- Schema: ${config.schemaVersion}\n- Modo: ${config.mode}\n`,
    "AGENTS.md": `# AGENTS.md\n\nContexto operativo de ${project.name}.\n\n## Regla base\n\n1. Leer primero .github/AGENTS.md.\n2. Usar docs/, openspec/ y .github/ como fuente versionada.\n3. Para cambios funcionales no triviales, exigir objetivo de negocio, KPI principal, readiness y matriz NFR.\n4. Mantener gate humano para promocion de borradores, PR, merge y deploy.\n5. Si hay conflicto entre una skill externa y una regla interna, prevalece .github/.\n`,
    "indice-operativo.md": `# Indice Operativo\n\nMapa minimo del SDLC multiagente instalado por SistemaMultiagente_SDLC.\n\n| Componente | Ubicacion |\n|---|---|\n| Gobierno | .github/AGENTS.md |\n| Agentes | .github/agents/ |\n| Estado compartido | .github/agent-state/ |\n| OpenSpec | openspec/ |\n| Guias | docs/guides/ |\n| Config local | .sdlc/config.json |\n`,
    ".github/AGENTS.md": `# AGENTS.md - Gobierno SDLC\n\nProyecto: ${project.name}\nModo: ${config.mode}\n\n## Orden de prioridad\n\n1. .github/AGENTS.md\n2. .github/instructions/*.instructions.md\n3. .github/skills/*/SKILL.md\n4. AGENTS.md e indice-operativo.md\n5. docs/agents/*.md y docs/guides/*.md\n\n## Flujo canonico\n\nF0-F17 gobierna ideas, analisis, planning, orquestacion, implementacion, QA, seguridad, PR, merge, archive y publish trace.\n\n## Superficies\n\n| ID | Path | Owner |\n|---|---|---|\n${surfaces}\n\n## Reglas\n\n- No implementar cambios funcionales no triviales sin definicion validada.\n- No promover borradores a Issue ni PR sin gate humano.\n- Usar handoffs cuando el trabajo cruce fase, agente o superficie.\n- Ejecutar validators cuando cambie gobierno, specs, docs o superficies del producto.\n`,
    ".github/agents/ownership-matrix.md": `# Ownership Matrix\n\n| Plane | Agente | Responsabilidad |\n|---|---|---|\n| control | planificador-opus | Planning, slices, dependencias, criterio de cierre |\n| control | orquestador-opus | Routing, handoffs, continuidad, estado compartido |\n| specialist | analista-requisitos | Definicion funcional, prior art, KPI, readiness |\n| specialist | arquitecto | Arquitectura, ADRs, boundaries, contratos |\n| specialist | api-agent | Backend/API y datos |\n| specialist | web-agent | UI y flujos visibles |\n| specialist | qa-security-review | QA, seguridad, drift y cierre |\n`,
    ".github/agent-state/phase-graph.yaml": renderPhaseGraph(),
    ".github/agent-state/current-slice.md": `# Current Slice\n\n## ID\n\n\`bootstrap-${project.slug}\`\n\n## Slice Type\n\n\`governance\`\n\n## Owner Plane\n\n\`control\`\n\n## SDLC Phase\n\n\`F0\`\n\n## Objetivo\n\nInicializar el sistema SDLC multiagente para ${project.name}.\n\n## Source Traceability\n\n- .sdlc/config.json\n- openspec/config.yaml\n\n## Owned Surfaces\n\n${config.surfaces.map((surface) => `- \`${surface.path}\``).join("\n")}\n\n## Validaciones\n\n- sdlc doctor --json\n- sdlc diff --json\n\n## Gate humano\n\nRequerido antes de promover cambios a PR.\n`,
    ".github/agent-state/handoffs/TEMPLATE.md": `# Handoff\n\n## Objetivo\n\n## Fase\n\n## Agente origen\n\n## Agente destino\n\n## Artefactos de entrada\n\n## Skills a cargar\n\n## Salida esperada\n\n## Criterio de cierre\n\n## Riesgos abiertos\n\n## Gate humano\n`,
    ".github/agent-state/templates/phase-gate.md": `# Phase Gate\n\n- Fase:\n- Veredicto: aprobado | requiere-cambios | rechazado\n- Evidencia:\n- Riesgos:\n- Gate humano:\n`,
    "docs/guides/sdlc-multiagente.md": `# Sistema Multiagente SDLC\n\nEste repo usa SistemaMultiagente_SDLC ${FRAMEWORK_VERSION}.\n\n## Contexto\n\nLa verdad normativa vive en el repo. La memoria externa, Graphify y chats importados ayudan a continuidad, pero no reemplazan docs/, openspec/ ni .github/.\n\n## Comandos\n\n- Continua\n- /resume\n- /save\n- /enrich-us\n- /opsx:ff\n- /opsx:apply\n- /opsx:verify\n- /opsx:archive\n`,
    "openspec/config.yaml": renderOpenSpecConfig(config),
    ".graphifyignore": `# Scope portable de Graphify\n*\n!AGENTS.md\n!indice-operativo.md\n!.github/agents/\n!.github/agents/**\n!.github/agent-state/\n!.github/agent-state/**\n!.github/skills/\n!.github/skills/**\n!docs/\n!docs/**\n!openspec/\n!openspec/**\ngraphify-out/\nnode_modules/\ndist/\ncoverage/\n`,
    "scripts/continua.ps1": `param([string]$Platform = "codex")\n$ErrorActionPreference = "Stop"\nWrite-Host "CONTINUA - $Platform"\nWrite-Host "Leer .github/agent-state/current-slice.md, phase-graph.yaml, graphify-out/GRAPH_REPORT.md y vault local si esta configurado."\n`,
    "scripts/publish-trace.ps1": `param([string]$Slice = "")\n$ErrorActionPreference = "Stop"\nWrite-Host "publish-trace pendiente para slice $Slice"\nWrite-Host "Este script base emite trazabilidad local; integracion gh se activa por repo consumidor."\n`,
    "scripts/export-graphify-obsidian.py": `from __future__ import annotations\n\nimport argparse\nfrom pathlib import Path\n\nparser = argparse.ArgumentParser()\nparser.add_argument("--graph", required=True)\nparser.add_argument("--output-dir", default="\${VAULT_PATH}/graphify/\${PROJECT_SLUG}")\nargs = parser.parse_args()\noutput = Path(args.output_dir)\noutput.mkdir(parents=True, exist_ok=True)\n(output / "README.md").write_text("# Graphify export\\n\\nDerivado de graphify-out. No editar como fuente de verdad.\\n", encoding="utf-8")\nprint(f"Export placeholder written to {output}")\n`,
    ".github/agent-state/telemetry/SCHEMA.md": `# Telemetry Schema\n\nEventos JSONL minimos:\n\n- phase_transition\n- handoff_created\n- validator_result\n- rework_requested\n- escalation\n\nv1 no incluye dashboard ni stack observable completo.\n`
  };

  if (config.frameworkVersion === "1.0.1") {
    files[".sdlc/migrations/1.0.1-applied.txt"] = `Migration 1.0.1 applied by SistemaMultiagente_SDLC.\n${generatedAt}\n`;
  }

  return files;
}
