import path from "node:path";
import { renderTemplates } from "./template-loader.js";
export { validateConfigShape } from "./config-validator.js";

export const FRAMEWORK_VERSION = "1.2.0";
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


export function buildManagedFiles(config) {
  const files = renderTemplates(config);
  files[".sdlc/config.json"] = `${JSON.stringify(config, null, 2)}\n`;
  return files;
}
