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
// Presupuesto GLOBAL de captura, en bytes. El tope por captura evita que UNA
// salida crezca sin fin, pero no protege al proceso: cuatro `ls-tree` de 256
// MiB cada uno son 1 GiB solo en stdout, y `Buffer.concat` + `toString` +
// `split` multiplican el pico real por encima de eso. Cada captura reserva su
// maximo declarado antes de arrancar, asi que un `ls-tree` grande corre solo
// mientras los comandos de 1 MiB siguen concurriendo entre si.
const CAPTURE_BUDGET_BYTES = 256 * 1024 * 1024;
let availableBudget = CAPTURE_BUDGET_BYTES;
const budgetQueue = [];

// Reserva INICIAL por captura. Reservar el maximo declarado por adelantado era
// correcto de memoria y desastroso de rendimiento: con presupuesto de 256 MiB y
// un `ls-tree` que declara 256 MiB, solo UNO podia correr a la vez y el pool
// quedaba serializado justo en su parte cara. Medido: el coste marginal por
// atestacion subio de 67 a 99 ms.
//
// La memoria no se consume al declarar el tope, se consume cuando llegan los
// bytes. Asi que se reserva poco y se crece bajo demanda: en el caso normal
// —arboles de unos pocos MiB— todas las capturas caben a la vez.
const INITIAL_RESERVE_BYTES = 8 * 1024 * 1024;

function acquireBudget(bytes) {
  // Una peticion mayor que el presupuesto entero esperaria para siempre: se
  // acota al total, de modo que corre sola pero corre.
  const need = Math.min(bytes, INITIAL_RESERVE_BYTES, CAPTURE_BUDGET_BYTES);
  if (availableBudget >= need) {
    availableBudget -= need;
    return { need, wait: null };
  }
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  budgetQueue.push({ need, grant: release });
  return { need, wait };
}

/**
 * Amplia la reserva de una captura que crecio mas de lo previsto. No espera: si
 * el presupuesto global esta agotado devuelve `false` y quien llama corta la
 * captura. Esperar aqui seria peor — el proceso hijo seguiria escribiendo
 * mientras nadie drena, y esto existe justamente para acotar memoria.
 */
function growBudget(extra) {
  if (availableBudget < extra) return false;
  availableBudget -= extra;
  return true;
}

function releaseBudget(need) {
  availableBudget += need;
  // FIFO a proposito: sin orden, una peticion grande podria quedarse esperando
  // indefinidamente mientras pasan las pequeñas.
  while (budgetQueue.length > 0 && availableBudget >= budgetQueue[0].need) {
    const next = budgetQueue.shift();
    availableBudget -= next.need;
    next.grant();
  }
}

export async function spawnCapture(command, args, { cwd, maxBuffer = 1024 * 1024, killGraceMs = 2000 } = {}) {
  const reservation = acquireBudget(maxBuffer);
  if (reservation.wait) await reservation.wait;
  // La reserva CRECE con la captura; al final se devuelve lo que de verdad se
  // llego a reservar, no lo que se pidio al empezar.
  const ledger = { reserved: reservation.need };
  try {
    return await captureProcess(command, args, { cwd, maxBuffer, killGraceMs, ledger });
  } finally {
    releaseBudget(ledger.reserved);
  }
}

/**
 * Decodifica los trozos capturados como UN solo buffer.
 *
 * Existe como funcion propia para poder probarla con cortes elegidos: la prueba
 * contra un proceso real depende de como el runtime trocee la salida, asi que
 * como regresion no es fiable — una implementacion rota puede pasar si los
 * cortes caen alineados.
 */
export function decodeCapture(chunks) {
  return Buffer.concat(chunks).toString("utf8");
}

function captureProcess(command, args, { cwd, maxBuffer, killGraceMs, ledger }) {
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
    // `settle` resuelve la promesa, pero NO cancela el watchdog: eso era un
    // defecto real — `trip()` armaba el temporizador y `settle()` lo cancelaba
    // acto seguido, asi que el SIGKILL nunca llegaba a ejecutarse. En Windows
    // no se notaba porque SIGTERM ya termina a la fuerza; en POSIX el hijo
    // sobrevivia. El watchdog solo se cancela cuando el hijo REALMENTE murio.
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    const cancelWatchdog = () => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
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
        killTimer = null;
        // `child.killed` no sirve: dice que se mando la señal, no que muriera.
        // `exitCode`/`signalCode` en null significa que sigue vivo, y solo
        // entonces se escala. Asi se estrecha la ventana en la que el PID pudo
        // reciclarse — no se elimina, porque la API de Node es por PID.
        if (child.exitCode === null && child.signalCode === null) {
          try {
            child.kill("SIGKILL");
          } catch {
            /* el hijo ya se fue entre la comprobacion y la señal */
          }
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

    // El presupuesto global se pide EN BLOQUES conforme la salida crece. Pedir
    // el maximo declarado por adelantado acotaba la memoria pero serializaba el
    // pool en su parte cara; pedirlo bajo demanda deja convivir a las capturas
    // normales, que son pequeñas, y solo estorba a las que de verdad crecen.
    const ensureBudget = (usados) => {
      if (usados <= ledger.reserved) return true;
      const extra = Math.max(usados - ledger.reserved, INITIAL_RESERVE_BYTES);
      if (!growBudget(extra)) return false;
      ledger.reserved += extra;
      return true;
    };

    child.stdout.on("data", (chunk) => {
      outSize += chunk.length;
      if (outSize > maxBuffer) return trip("stdout");
      if (!ensureBudget(outSize + errSize)) return trip("presupuesto global");
      out.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      errSize += chunk.length;
      if (errSize > maxBuffer) return trip("stderr");
      if (!ensureBudget(outSize + errSize)) return trip("presupuesto global");
      err.push(chunk);
    });
    child.on("error", (error) => settle({ ok: false, stdout: "", stderr: error.message, overflow }));
    // `exit` y `close` son el unico momento en que consta que el hijo murio, y
    // por tanto el unico en que el watchdog sobra. Cancelarlo antes deja vivo
    // justo al proceso que se pretendia matar.
    child.on("exit", cancelWatchdog);
    child.on("close", (code) => {
      cancelWatchdog();
      settle({
        ok: code === 0,
        stdout: decodeCapture(out),
        stderr: decodeCapture(err),
        overflow: false
      });
    });
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
