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
import { FRAMEWORK_VERSION, validateConfigShape } from "./render.js";

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
  const resolvedTarget = path.resolve(target);

  // `declared` es lo que el package.json DICE, no lo que se puede resolver.
  // Antes se derivaba del exito de require.resolve, con lo que un consumidor
  // que declara la dependencia pero todavia no corrio su install quedaba
  // `declared:false` — indistinguible de uno que nunca la declaro. Dos estados
  // distintos con una sola senal es justo lo que este framework rechaza en el
  // codigo del consumidor.
  let declared = false;
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(resolvedTarget, "package.json"), "utf8"));
    declared = Boolean(manifest.dependencies?.[PACKAGE_NAME]) || Boolean(manifest.devDependencies?.[PACKAGE_NAME]);
  } catch {
    declared = false;
  }

  try {
    const require = createRequire(path.join(resolvedTarget, "package.json"));
    const resolved = require.resolve(`${PACKAGE_NAME}/package.json`);

    // Node resuelve por REALPATH. Con pnpm el paquete real vive en el store
    // virtual (`node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>`) y lo que
    // cuelga de `node_modules/<pkg>` es un enlace: anclar al directorio exacto
    // marcaba como `linked` una instalacion pnpm perfectamente normal. El repo
    // padre usa pnpm, asi que `doctor` le avisaba de un link inexistente
    // diciendo ademas que "CI lo rechaza" cuando CI lo acepta: el bash de
    // quality-verify.yml admite CUALQUIER ruta que contenga node_modules, y
    // esta funcion existe justamente para no reimplementar ese criterio de otra
    // manera. Lo que importa es si el paquete sale del arbol node_modules del
    // target, no de que subdirectorio concreto.
    const nodeModules = path.join(resolvedTarget, "node_modules");
    const roots = [nodeModules];
    try {
      roots.push(fs.realpathSync(nodeModules));
    } catch {
      // sin node_modules en disco: queda solo la ruta nominal
    }
    const insideTargetTree = roots.some((root) => resolved.startsWith(root + path.sep));
    return { declared, installed: true, linked: !insideTargetTree, resolved };
  } catch {
    // Declarada pero sin resolver = no instalada. No es lo mismo que ausente,
    // y `linked` no se puede afirmar sobre algo que no existe en disco.
    return { declared, installed: false, linked: null, resolved: null };
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  return { ok: result.status === 0, stdout: (result.stdout ?? "").trim() };
}

// La rama de integracion no es cosmetica: `gitFlow.integrationBranch` alimenta
// el `BASE` contra el que el guard de frontera compara el PR y la comprobacion
// de ancestria de `change-close`. Apuntar a la rama equivocada no rompe nada de
// forma visible -- produce un diff contra otra base, que es peor.
//
// El orden de respaldo pone `develop` antes que `main` para coincidir con
// `resolveBase` del guard (templates/scripts/validate-spec-boundary.mjs) y con
// el default de `defaultConfig`. Antes era el contrario: dos piezas del mismo
// framework con precedencias opuestas sobre el mismo repo.
//
// `origin/HEAD` sigue mandando cuando existe, porque es lo que el repo DECLARA
// como rama por defecto. Pero en un repo gitflow suele apuntar a `main` mientras
// la integracion ocurre en `develop`, asi que cuando hay mas candidatas se
// devuelven todas: elegir en silencio entre alternativas es como se cuela una
// base equivocada.
function detectIntegrationBranch(target) {
  const FALLBACK_ORDER = ["develop", "main", "master"];
  const existing = FALLBACK_ORDER.filter(
    (candidate) => git(["rev-parse", "--verify", "--quiet", `origin/${candidate}`], target).ok
  );

  const remoteHead = git(["symbolic-ref", "refs/remotes/origin/HEAD"], target);
  if (remoteHead.ok && remoteHead.stdout) {
    const declared = remoteHead.stdout.replace("refs/remotes/origin/", "");
    return { branch: declared, source: "origin/HEAD", alternatives: existing.filter((name) => name !== declared) };
  }
  if (existing.length > 0) {
    return { branch: existing[0], source: "rama remota existente", alternatives: existing.slice(1) };
  }
  return { branch: "main", source: "default sin remoto resoluble", alternatives: [] };
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
  let integrationBranch = null;
  if (!pathExists(configPath)) {
    const projectName = options["project-name"] ?? packageJson.name ?? path.basename(target);
    integrationBranch = detectIntegrationBranch(target);
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
        integrationBranch: integrationBranch.branch,
        stableBranch: "main",
        branchPrefixes: ["feature/", "fix/", "docs/"]
      },
      openspec: { profile: "minimal" }
    };

    // Se valida ANTES de escribir y, sobre todo, antes de interpolar. `adopt`
    // era la puerta de al lado del mismo agujero que se cerro en `upgrade`:
    // `--project-name` (o `package.json.name`) llega crudo hasta
    // `interpolate()`, que sustituye texto sin escapar, y de ahi a
    // quality-contract.yaml -- un archivo que el guard de frontera SI protege,
    // alcanzado desde una entrada que nadie valida. Reproducido: un nombre con
    // un salto de linea inyectaba `enforcement: block` como clave real.
    const configErrors = validateConfigShape(config);
    if (configErrors.length > 0) {
      return {
        exitCode: EXIT_ERROR,
        payload: {
          status: "error",
          code: "adopt-config-invalid",
          errors: configErrors,
          detail: "el config derivado no pasa el schema; adopt no escribe ni genera contratos a partir de el"
        }
      };
    }
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
    // Se reporta en POSIX siempre. `path.join` usa el separador del sistema, y
    // en Windows el payload mezclaba `schemas\phase-evidence.schema.json` con
    // rutas de barra normal en la misma lista JSON.
    const reported = relativePath.split(path.sep).join("/");
    if (pathExists(destination)) {
      skipped.push(`${reported} (ya existe)`);
      continue;
    }
    writeText(destination, fs.readFileSync(path.join(moduleRoot, relativePath), "utf8"));
    created.push(reported);
  }

  const cli = detectCliLinked(target);

  return {
    exitCode: EXIT_OK,
    payload: {
      status: "ok",
      message: "adopt es aditivo: nunca sobreescribe lo que ya existe. Correrlo de nuevo despues de editar a mano es seguro.",
      created,
      skipped,
      cli,
      // La rama de integracion decide contra que base compara el guard de
      // frontera. Cuando se eligio entre varias candidatas hay que decirlo:
      // en un repo gitflow `origin/HEAD` suele apuntar a `main` mientras la
      // integracion ocurre en `develop`, y elegir en silencio es como se cuela
      // una base equivocada que nadie revisa.
      ...(integrationBranch
        ? {
            gitFlow: {
              integrationBranch: integrationBranch.branch,
              detectedFrom: integrationBranch.source,
              alternatives: integrationBranch.alternatives,
              ...(integrationBranch.alternatives.length > 0
                ? {
                    hint: `tambien existe(n) origin/${integrationBranch.alternatives.join(", origin/")}: si la integracion real de este repo ocurre ahi, corregir gitFlow.integrationBranch en .sdlc/config.json antes de correr el guard`
                  }
                : {})
            }
          }
        : {})
    }
  };
}
