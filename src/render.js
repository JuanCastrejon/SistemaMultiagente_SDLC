import path from "node:path";
import { renderTemplates } from "./template-loader.js";

export const FRAMEWORK_VERSION = "1.0.0";
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

export function buildManagedFiles(config) {
  const files = renderTemplates(config);
  files[".sdlc/config.json"] = `${JSON.stringify(config, null, 2)}\n`;
  if (config.frameworkVersion === "1.0.1") {
    files[".sdlc/migrations/1.0.1-applied.txt"] = `Migration 1.0.1 applied by SistemaMultiagente_SDLC.\ngenerated-by-sdlc\n`;
  }
  return files;
}
