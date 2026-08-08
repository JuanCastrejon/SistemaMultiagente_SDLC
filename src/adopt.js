// ---------------------------------------------------------------------------
// `sdlc adopt` (ADR 0007, P13, decision 9 del cierre de decisiones)
//
// El piloto resolvia el CLI del framework por `npm link` global al working
// tree del framework: corria codigo sin publicar, de una rama sucia. Un
// arbitro asi no arbitra nada -- el mismo problema que P2 cierra para el
// guard de frontera, aqui aplicado al CLI entero. La decision 9 lo abandona:
// devDependency versionada, nunca link.
//
// `sdlc install` asume un scaffold completo (managed files, backups,
// manifest) pensado para greenfield o legacy sin estructura propia. Un
// consumidor maduro (el repo padre: 25 ADRs propios, telemetria, calibracion)
// no quiere que eso le reescriba nada encima. `adopt` es ADITIVO PURO: nunca
// sobreescribe un archivo que ya existe, solo entrega lo minimo para que el
// gauntlet de calidad funcione. Correrlo dos veces es seguro.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathExists, readJson, writeJson, writeText } from "./file-utils.js";
import { buildQualityContractSurfaces, interpolate, templatesRoot } from "./template-loader.js";
import { FRAMEWORK_VERSION } from "./render.js";

const EXIT_OK = 0;
const EXIT_ERROR = 1;

const PACKAGE_NAME = "sistema-multiagente-sdlc";

/**
 * Mismo chequeo que `quality-verify.yml` hace en bash para el arbitro de CI,
 * expuesto como funcion real para que `doctor` y `adopt` lo compartan en vez
 * de reimplementarlo cada uno a su manera.
 *
 * Debe resolver desde el TARGET (el repo consumidor), nunca desde
 * `import.meta.url` (el propio modulo del framework): resolver desde el
 * framework es ciego exactamente en el escenario de `npm link` que este
 * chequeo existe para detectar -- el framework no se depende a si mismo, asi
 * que la resolucion revienta y cae al catch, indistinguible de "no hay
 * dependencia" (`declared:false`).
 */
export function detectCliLinked(target = process.cwd()) {
  try {
    const resolvedTarget = path.resolve(target);
    const require = createRequire(path.join(resolvedTarget, "package.json"));
    const resolved = require.resolve(`${PACKAGE_NAME}/package.json`);
    const expectedInstallDir = path.join(resolvedTarget, "node_modules", PACKAGE_NAME) + path.sep;
    return { declared: true, linked: !resolved.startsWith(expectedInstallDir), resolved };
  } catch {
    return { declared: false, linked: null, resolved: null };
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim() };
}

function detectIntegrationBranch(target) {
  const remoteHead = git(["symbolic-ref", "refs/remotes/origin/HEAD"], target);
  if (remoteHead.ok && remoteHead.stdout) {
    return remoteHead.stdout.replace("refs/remotes/origin/", "");
  }
  for (const candidate of ["main", "develop", "master"]) {
    if (git(["rev-parse", "--verify", "--quiet", `origin/${candidate}`], target).ok) return candidate;
  }
  return "main";
}

function slugFromName(name) {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "proyecto";
}

export function commandAdopt(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  const packageJsonPath = path.join(target, "package.json");
  if (!pathExists(packageJsonPath)) {
    return {
      exitCode: EXIT_ERROR,
      payload: { status: "error", message: "sdlc adopt exige un package.json existente: no es un scaffold, es incorporacion a un repo ya vivo." }
    };
  }

  const created = [];
  const skipped = [];

  // 1. devDependency versionada. Es el punto central de esta pieza: la
  // decision 9 abandona npm link porque el evaluado no puede ser quien
  // controla el codigo que lo arbitra. Una declaracion `file:`/`link:` es el
  // mismo problema con otro nombre -- sigue apuntando a un working tree local
  // en vez de una version publicada -- asi que se migra, no se deja pasar
  // como "ya declarada".
  const packageJson = readJson(packageJsonPath);
  const declaredIn = packageJson.dependencies?.[PACKAGE_NAME] ? "dependencies" : packageJson.devDependencies?.[PACKAGE_NAME] ? "devDependencies" : null;
  const declaredValue = declaredIn ? packageJson[declaredIn][PACKAGE_NAME] : null;
  const isLinkProtocol = typeof declaredValue === "string" && /^(file|link):/.test(declaredValue);
  const alreadyDeclared = Boolean(declaredIn) && !isLinkProtocol;
  if (!alreadyDeclared) {
    if (isLinkProtocol) delete packageJson[declaredIn][PACKAGE_NAME];
    packageJson.devDependencies = packageJson.devDependencies ?? {};
    packageJson.devDependencies[PACKAGE_NAME] = `^${FRAMEWORK_VERSION}`;
    writeJson(packageJsonPath, packageJson);
    created.push(
      isLinkProtocol
        ? `package.json (${declaredValue} reemplazado por devDependency versionada)`
        : "package.json (devDependency agregada)"
    );
  } else {
    skipped.push("package.json (ya declara sistema-multiagente-sdlc)");
  }

  // 2. .sdlc/config.json minimo, SIN inventar superficies: un repo maduro
  // tiene su propio layout, no apps/api ni apps/web de ejemplo (ver P6).
  const configPath = path.join(target, ".sdlc", "config.json");
  if (!pathExists(configPath)) {
    const projectName = options["project-name"] ?? packageJson.name ?? path.basename(target);
    const config = {
      $schema: "./schemas/sdlc.config.schema.json",
      schemaVersion: 1,
      frameworkVersion: FRAMEWORK_VERSION,
      project: { name: projectName, slug: slugFromName(projectName) },
      mode: "legacy",
      surfaces: [],
      // Sin maintainers: `maintainers: []` viola el minItems:1 del schema
      // (el propio validador de este framework lo rechaza) -- el campo es
      // opcional, se omite hasta que el consumidor declare firmantes reales.
      governance: { threatModel: "single-maintainer" },
      gitFlow: {
        integrationBranch: detectIntegrationBranch(target),
        stableBranch: "main",
        branchPrefixes: ["feature/", "fix/", "docs/"]
      },
      openspec: { profile: "minimal" }
    };
    writeJson(configPath, config);
    created.push(".sdlc/config.json");
  } else {
    skipped.push(".sdlc/config.json (ya existe)");
  }

  // 3. quality-contract.yaml generado desde config.surfaces (P6), nunca con
  // superficies de ejemplo.
  const contractPath = path.join(target, "quality-contract.yaml");
  if (!pathExists(contractPath)) {
    const config = readJson(configPath);
    const raw = fs.readFileSync(path.join(templatesRoot(), "quality-contract.yaml"), "utf8");
    const rendered = interpolate(raw, {
      project: config.project,
      qualityContractSurfaces: buildQualityContractSurfaces(config.surfaces ?? [])
    });
    writeText(contractPath, rendered);
    created.push("quality-contract.yaml");
  } else {
    skipped.push("quality-contract.yaml (ya existe)");
  }

  // 4. phase-contract.yaml y su schema de evidencia, verbatim, solo si faltan.
  const moduleRoot = path.resolve(templatesRoot(), "..");
  const verbatimFiles = ["phase-contract.yaml", path.join("schemas", "phase-evidence.schema.json")];
  for (const relativePath of verbatimFiles) {
    const destination = path.join(target, relativePath);
    if (pathExists(destination)) {
      skipped.push(`${relativePath} (ya existe)`);
      continue;
    }
    writeText(destination, fs.readFileSync(path.join(moduleRoot, relativePath), "utf8"));
    created.push(relativePath);
  }

  const cli = detectCliLinked(target);

  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      message: "adopt es aditivo: nunca sobreescribe lo que ya existe. Correrlo de nuevo despues de editar a mano es seguro.",
      created,
      skipped,
      cli
    }
  };
}
