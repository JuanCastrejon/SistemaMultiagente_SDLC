import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

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

/**
 * Lanza un proceso y captura su salida SIN bloquear el hilo, con la misma
 * semantica que `spawnSync`: acumula BUFFERS y decodifica una sola vez al
 * cerrar, y aplica un limite de tamaño explicito.
 *
 * Las dos cosas son correcciones de defectos medidos, no precaucion:
 *
 *  - Concatenar `stdout += chunk` decodifica cada trozo por separado, asi que un
 *    caracter UTF-8 partido entre dos chunks se convierte en `?`. Reproducido
 *    con `A` acentuada: la via sincrona la conserva y la concatenacion async
 *    devolvia dos caracteres de reemplazo. En este framework eso llega hasta el
 *    firmante (`%GS`) y el mensaje del commit (`%B`), asi que la auditoria podia
 *    rechazar a un maintainer con tilde que el gate aceptaba.
 *  - `spawnSync` trae `maxBuffer` de 1 MiB por defecto y falla con `ENOBUFS` al
 *    excederlo; sin limite en la via async, la misma entrada daba resultados
 *    distintos por cada camino. Dos verificadores que no coinciden son peores
 *    que uno solo.
 */
export function spawnCapture(command, args, { cwd, maxBuffer = 1024 * 1024, killGraceMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd });
    const out = [];
    const err = [];
    let outSize = 0;
    let errSize = 0;
    let overflow = false;
    let settled = false;
    let killTimer = null;

    // Un solo punto de resolucion. `error` y `close` pueden dispararse los dos
    // —en un fallo de spawn, `close` llega DESPUES de `error`—, y sin esta
    // guarda el segundo pisaba el estado del primero: en particular, un `error`
    // tras marcar desbordamiento reportaba `overflow: false`.
    const settle = (result) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve(result);
    };

    // `maxBuffer` en Node se aplica a stdout **o** stderr, no solo al primero.
    // Limitar unicamente stdout dejaba dos agujeros medidos: un hijo que escribe
    // 2 MiB por stderr devolvia `ok: true` mientras `spawnSync` fallaba con
    // ENOBUFS —o sea, las dos vias volvian a divergir—, y esa acumulacion sin
    // tope era ademas via de agotar memoria con cuatro capturas en vuelo.
    const trip = (stream) => {
      if (overflow) return;
      overflow = true;
      // Se resuelve YA, sin esperar a `close`. `kill()` manda SIGTERM y no
      // garantiza nada: un hijo puede ignorarlo, o un descendiente puede
      // mantener el pipe abierto, y entonces `close` no llega nunca y la
      // promesa —y con ella el hueco del pool— se queda colgada para siempre.
      child.kill();
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* el hijo ya se fue */
        }
      }, killGraceMs);
      killTimer.unref?.();
      settle({
        ok: false,
        stdout: "",
        stderr: `la salida (${stream}) de ${command} supero maxBuffer (${maxBuffer} bytes)`,
        overflow: true
      });
    };

    child.stdout.on("data", (chunk) => {
      outSize += chunk.length;
      if (outSize > maxBuffer) return trip("stdout");
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      errSize += chunk.length;
      if (errSize > maxBuffer) return trip("stderr");
      err.push(chunk);
    });
    child.on("error", (error) => settle({ ok: false, stdout: "", stderr: error.message, overflow }));
    child.on("close", (code) =>
      settle({
        ok: code === 0,
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        overflow: false
      })
    );
  });
}

export function sha256File(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

/**
 * Igual que `sha256File` pero sobre el contenido con finales de linea
 * normalizados a LF.
 *
 * Existe por un defecto reproducido en un consumidor Windows real: el manifiesto
 * de instalacion se versiona, y con `core.autocrlf=true` git lo entrega en CRLF
 * al hacer checkout. El framework lo escribe en LF, asi que el hash de bytes
 * crudos dejaba de coincidir sin que NADIE hubiera tocado el archivo — y el
 * diagnostico acusaba "Manifest corrupto o editado manualmente". Consecuencia
 * real: `sdlc upgrade` quedaba bloqueado para siempre en ese repo, es decir, el
 * consumidor no podia recibir ninguna correccion.
 *
 * El resto del framework ya comparaba contenido normalizado (`normalizeLF` en
 * el calculo de drift); el checksum del manifiesto era la unica pieza que
 * miraba los bytes.
 */
export function sha256FileNormalized(filePath) {
  const text = fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
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
