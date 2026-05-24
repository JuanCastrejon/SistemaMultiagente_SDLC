import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { renderTemplates, templatesRoot } from "./template-loader.js";
export { validateConfigShape } from "./config-validator.js";

export const FRAMEWORK_VERSION = "1.5.0";
export const SCHEMA_VERSION = 1;
export const SUPPORTED_MODES = new Set(["greenfield", "legacy"]);

export function slugify(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "proyecto";
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function buildSharedRulesBlock(config) {
  const body = [
    "1. La fuente normativa vive en `.github/`, `openspec/`, `docs/`, `AGENTS.md` e `indice-operativo.md`.",
    "2. Todo cambio funcional no trivial requiere business fit, KPI, readiness, matriz NFR y cambio OpenSpec antes de implementar.",
    `3. Las ramas permitidas son \`${config.gitFlow.branchPrefixes.join("`, `")}\`; integracion en \`${config.gitFlow.integrationBranch}\` y estable en \`${config.gitFlow.stableBranch}\`.`,
    "4. Los gates humanos no se automatizan: borrador local -> revision humana -> Issue/PR -> validacion -> merge.",
    "5. La continuidad lee contexto en orden repo -> CodeGraph -> graphify-out -> vault Obsidian.",
    "6. Las skills canonicas viven en `.github/skills/` y sus mirrors de IDE deben conservar el mismo hash."
  ].join("\n");
  return [
    `<!-- SDLC_SHARED_RULES_START sha256:${sha256Text(body)} -->`,
    body,
    "<!-- SDLC_SHARED_RULES_END -->"
  ].join("\n");
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
    scale: "feature",
    stack: {
      backend: "<BACKEND_STACK>",
      frontend: "<FRONTEND_STACK>",
      database: "<DATABASE_STACK>",
      designSystem: "<DESIGN_SYSTEM>",
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
      specialistPlane: ["product-owner-agent", "project-manager-agent", "analista-requisitos", "arquitecto", "api-agent", "web-agent", "qa-test-architect-agent", "qa-security-review"]
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


export function buildManagedFiles(config) {
  const files = renderTemplates({ ...config, sdlcSharedRulesBlock: buildSharedRulesBlock(config) });
  const root = path.resolve(templatesRoot(), "..");
  files["phase-contract.yaml"] = fs.readFileSync(path.join(root, "phase-contract.yaml"), "utf8");
  files["schemas/phase-evidence.schema.json"] = fs.readFileSync(path.join(root, "schemas", "phase-evidence.schema.json"), "utf8");
  addSkillMirrors(files);
  addPhaseTemplates(files);
  files[".sdlc/config.json"] = `${JSON.stringify(config, null, 2)}\n`;
  return files;
}

function addSkillMirrors(files) {
  const skillNames = new Set();
  for (const filePath of Object.keys(files)) {
    const match = /^\.github\/skills\/([^/]+)\/SKILL\.md$/.exec(filePath);
    if (match) skillNames.add(match[1]);
  }
  for (const skillName of [...skillNames].sort()) {
    const sourcePath = `.github/skills/${skillName}/SKILL.md`;
    const source = files[sourcePath];
    const hash = sha256Text(source);
    const mirror = [
      "---",
      "managed: true",
      `source: .github/skills/${skillName}/SKILL.md`,
      `source_sha256: ${hash}`,
      "---",
      "",
      source.trimEnd(),
      ""
    ].join("\n");
    for (const root of [".claude/skills", ".agents/skills", ".windsurf/skills"]) {
      files[`${root}/${skillName}/SKILL.md`] = mirror;
    }
  }
}

function addPhaseTemplates(files) {
  const root = path.join(templatesRoot(), "phases");
  if (!fs.existsSync(root)) return;
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      const relative = path.relative(templatesRoot(), absolute).replace(/\\/g, "/");
      files[relative] = fs.readFileSync(absolute, "utf8");
    }
  };
  walk(root);
}
