import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Pregunta a git cuales de estas rutas estan ignoradas. Es la unica fuente
 * correcta: entiende los .gitignore ANIDADOS, `.git/info/exclude`, el global
 * del usuario y la precedencia real de las reglas de negacion. Reimplementarlo
 * con regex es inevitablemente incorrecto (la auditoria adversarial encontro
 * cinco formas de evadir la version textual).
 *
 * Vive aqui, y no en el modulo que lo necesito primero, porque ya lo usan dos
 * piezas con propositos distintos (retencion y ancla de arbol). La leccion de
 * `detectCliLinked` en este mismo slice: dos copias del mismo criterio divergen,
 * y cuando divergen nadie se entera.
 *
 * Devuelve `null` si no se pudo preguntar (git ausente o target que no es un
 * repo): quien llama decide que hacer con esa incertidumbre, nunca se finge un
 * conjunto vacio.
 */
export function listIgnoredPaths(target, relativePaths) {
  if (relativePaths.length === 0) return new Set();
  const result = spawnSync("git", ["check-ignore", "--stdin"], {
    cwd: target,
    input: relativePaths.join("\n"),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  // 0 = alguna ruta ignorada, 1 = ninguna. Cualquier otro codigo (128 = no es
  // un repo, o git ausente) significa que no se pudo preguntar.
  if (result.status !== 0 && result.status !== 1) return null;
  return new Set(
    (result.stdout ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\\/g, "/"))
      .filter(Boolean)
  );
}

export function toPosixPath(value) {
  return value.replace(/\\/g, "/");
}

export function sha256Text(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

export function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

export function pathExists(filePath) {
  return fs.existsSync(filePath);
}

export function readTextIfExists(filePath) {
  return pathExists(filePath) ? fs.readFileSync(filePath, "utf8") : null;
}

export function readPackageScripts(target) {
  const raw = readTextIfExists(path.join(target, "package.json"));
  if (!raw) return null;
  try {
    const scripts = JSON.parse(raw).scripts;
    return scripts && typeof scripts === "object" ? scripts : {};
  } catch {
    return null;
  }
}

export function normalizeLF(value) {
  return value.replace(/\r\n/g, "\n");
}

export function writeText(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, normalizeLF(value), "utf8");
}

export function removePath(targetPath) {
  if (pathExists(targetPath)) {
    fs.rmSync(targetPath, { recursive: true, force: true });
  }
}

export function copyFilePreservingPath(sourceRoot, targetRoot, relativePath) {
  const source = path.join(sourceRoot, relativePath);
  const target = path.join(targetRoot, relativePath);
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

export function listFiles(root, options = {}) {
  // `.sdlc` es estado local de runtime (backups, vault de continuidad,
  // session.json, patch-plan) que el propio CLI escribe al correr
  // `sdlc install/save/resume` contra el framework mismo. No es codigo fuente
  // ni contenido gestionado: ningun validador de scripts/*.mjs tiene motivo
  // para inspeccionarlo, y hacerlo produce falsos positivos (ej.
  // validate-no-personal-paths) puramente por desarrollo local, invisibles en
  // CI porque un checkout fresco nunca tiene `.sdlc/`.
  const ignored = options.ignored ?? new Set([".git", "node_modules", ".turbo", "dist", "coverage", ".sdlc"]);
  const results = [];

  function walk(current) {
    if (!pathExists(current)) {
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) {
        continue;
      }
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else {
        results.push(toPosixPath(path.relative(root, absolute)));
      }
    }
  }

  walk(root);
  return results.sort();
}

export function stableJson(value) {
  return `${JSON.stringify(value, Object.keys(value).sort(), 2)}\n`;
}
