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

// ---------------------------------------------------------------------------
// Presupuesto de memoria para capturas concurrentes.
//
// El tope por captura evita que UNA salida crezca sin fin; no protege al
// proceso. Cuatro `ls-tree` de 256 MiB son 1 GiB solo en chunks retenidos, y
// `Buffer.concat` + `toString` + `split` multiplican el pico. Este presupuesto
// acota los chunks RETENIDOS, que es lo unico que este modulo controla — el
// transitorio de decodificacion queda fuera y esta declarado como limite.
//
// Se reserva poco y se crece bajo demanda: reservar el maximo declarado por
// adelantado acotaba igual la memoria pero serializaba el pool en su parte
// cara. Medido: el coste marginal por atestacion pasaba de 67 a 99 ms.
// ---------------------------------------------------------------------------

const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;
const INITIAL_RESERVE_BYTES = 8 * 1024 * 1024;

/**
 * Crea un presupuesto aislado. Existe para poder probarlo con cifras pequeñas
 * sin generar cientos de MiB, y para que dos usos concurrentes puedan no
 * compartir techo cuando eso importe.
 */
export function createCaptureBudget(totalBytes = DEFAULT_BUDGET_BYTES) {
  let available = totalBytes;
  const queue = [];

  const drain = () => {
    while (queue.length > 0 && available >= queue[0].need) {
      const next = queue.shift();
      available -= next.need;
      next.grant();
    }
  };

  return {
    total: totalBytes,
    // Reserva inicial. SIN barging: si ya hay alguien esperando, el que llega
    // se pone a la cola aunque quepa. Permitir colarse dejaba a la cabeza de la
    // cola en inanicion indefinida bajo trafico continuo de capturas pequeñas.
    acquire(bytes) {
      const need = Math.max(0, Math.min(bytes, INITIAL_RESERVE_BYTES, totalBytes));
      if (queue.length === 0 && available >= need) {
        available -= need;
        return { need, wait: null };
      }
      let grant;
      const wait = new Promise((resolve) => {
        grant = resolve;
      });
      queue.push({ need, grant });
      return { need, wait };
    },
    // Crecimiento bajo demanda. NO espera: el hijo ya esta escribiendo y nadie
    // drenaria mientras tanto, que es justo lo que este tope existe para
    // impedir. Tampoco respeta la cola, porque bloquear aqui a quien ya tiene
    // memoria reservada mientras espera a quien espera memoria es un abrazo
    // mortal de manual.
    grow(extra) {
      if (available < extra) return false;
      available -= extra;
      return true;
    },
    release(bytes) {
      available += bytes;
      drain();
    },
    // Solo para pruebas y diagnostico.
    availableBytes() {
      return available;
    },
    waiting() {
      return queue.length;
    }
  };
}

const globalBudget = createCaptureBudget();

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

/**
 * Lanza un proceso y captura su salida SIN bloquear el hilo, con la misma
 * semantica que `spawnSync`: acumula BUFFERS y decodifica una sola vez al
 * cerrar, y aplica un limite de tamaño explicito.
 *
 * Las dos cosas son correcciones de defectos medidos, no precaucion:
 *
 *  - Concatenar `stdout += chunk` decodifica cada trozo por separado, asi que un
 *    caracter UTF-8 partido entre dos chunks se convierte en reemplazo. En este
 *    framework eso llega hasta el firmante (`%GS`) y el mensaje del commit
 *    (`%B`), asi que la auditoria podia rechazar a un maintainer con tilde que
 *    el gate aceptaba.
 *  - `spawnSync` trae `maxBuffer` de 1 MiB por defecto y falla con `ENOBUFS` al
 *    excederlo; sin limite en la via async, la misma entrada daba resultados
 *    distintos por cada camino. Dos verificadores que no coinciden son peores
 *    que uno solo.
 *
 * LIMITE CONOCIDO: al desbordar se termina el ARBOL de procesos (grupo en POSIX,
 * `taskkill /T` en Windows), pero si un nieto sobrevive y hereda los pipes, el
 * proceso padre puede tardar en salir. No se promete lo contrario.
 */
export async function spawnCapture(
  command,
  args,
  { cwd, maxBuffer = 1024 * 1024, killGraceMs = 2000, budget = globalBudget } = {}
) {
  // Un `maxBuffer` no finito o negativo dejaba una entrada de cola imposible de
  // satisfacer, o descuadraba el contador. Se valida antes de tocar nada.
  if (!Number.isFinite(maxBuffer) || maxBuffer < 0) {
    throw new TypeError(`maxBuffer tiene que ser un numero finito >= 0, y llego ${maxBuffer}`);
  }

  const reservation = budget.acquire(maxBuffer);
  if (reservation.wait) await reservation.wait;
  // La reserva CRECE con la captura; al final se devuelve lo que de verdad se
  // llego a reservar, no lo que se pidio al empezar.
  const ledger = { reserved: reservation.need };
  try {
    return await captureProcess(command, args, { cwd, maxBuffer, killGraceMs, ledger, budget });
  } finally {
    budget.release(ledger.reserved);
    // Se congela para que un chunk tardio —los listeners siguen vivos tras un
    // corte— no pueda descontar presupuesto que ya nadie va a devolver. Esa
    // fuga vaciaba el presupuesto global de forma permanente y dejaba la cola
    // esperando para siempre.
    ledger.closed = true;
  }
}

// Terminar el ARBOL, no solo el hijo. `child.kill()` no alcanza a los nietos, y
// un nieto que herede los pipes puede retrasar la salida del proceso padre
// mucho despues de que la promesa haya resuelto.
function killTree(child) {
  if (process.platform === "win32") {
    // En Windows no hay grupos de procesos POSIX; `taskkill /T` recorre el
    // arbol. Se lanza y se olvida: es limpieza, no camino critico.
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).unref();
    } catch {
      /* si taskkill no esta, queda el kill directo de abajo */
    }
  } else {
    // `detached: true` puso al hijo en su propio grupo; el negativo mata al
    // grupo entero.
    try {
      process.kill(-child.pid, "SIGTERM");
      return;
    } catch {
      /* el grupo ya no existe: se cae al kill directo */
    }
  }
  try {
    child.kill();
  } catch {
    /* ya se fue */
  }
}

function killTreeForce(child) {
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" }).unref();
    } catch {
      /* nada mas que hacer */
    }
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* ya se fue */
    }
  }
}

function captureProcess(command, args, { cwd, maxBuffer, killGraceMs, ledger, budget }) {
  return new Promise((resolve) => {
    // `detached` en POSIX crea grupo de procesos propio, que es lo que permite
    // matar a los nietos. En Windows no aplica y se usa `taskkill /T`.
    const child = spawn(command, args, { cwd, detached: process.platform !== "win32" });
    const out = [];
    const err = [];
    let outSize = 0;
    let errSize = 0;
    let overflow = false;
    let settled = false;
    let killTimer = null;

    // Un solo punto de resolucion. `error` y `close` pueden dispararse los dos
    // —en un fallo de spawn, `close` llega DESPUES de `error`—, y sin esta
    // guarda el segundo pisaba el estado del primero.
    //
    // `settle` NO cancela el watchdog: eso era un defecto real — `trip()`
    // armaba el temporizador y `settle()` lo cancelaba acto seguido, asi que el
    // SIGKILL nunca llegaba a ejecutarse. El watchdog solo se cancela cuando
    // consta que el hijo murio.
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

    const trip = (motivo, detalle) => {
      if (overflow) return;
      overflow = true;
      // Se resuelve YA, sin esperar a `close`: matar no garantiza que el hijo
      // muera, y esperarlo dejaria la promesa —y el hueco del pool— colgada.
      killTree(child);
      killTimer = setTimeout(() => {
        killTimer = null;
        // `child.killed` solo dice que se mando la señal. `exitCode`/
        // `signalCode` en null significa que sigue vivo, y solo entonces se
        // escala: asi se estrecha la ventana de PID reciclado.
        if (child.exitCode === null && child.signalCode === null) killTreeForce(child);
      }, killGraceMs);
      killTimer.unref?.();
      settle({ ok: false, stdout: "", stderr: detalle, overflow: true, reason: motivo });
    };

    // El presupuesto global se pide EN BLOQUES conforme la salida crece.
    const ensureBudget = (usados) => {
      if (usados <= ledger.reserved) return true;
      const extra = Math.max(usados - ledger.reserved, INITIAL_RESERVE_BYTES);
      if (!budget.grow(extra)) return false;
      ledger.reserved += extra;
      return true;
    };

    // Tras un corte los listeners SIGUEN vivos hasta que el hijo cierre. Todo
    // lo que llegue despues se descarta sin tocar contadores: si no, un chunk
    // tardio del otro stream crecia el ledger despues de que el `finally` ya
    // hubiera devuelto la reserva, y ese presupuesto se perdia para siempre.
    const acepta = () => !settled && !overflow && !ledger.closed;

    child.stdout.on("data", (chunk) => {
      if (!acepta()) return;
      outSize += chunk.length;
      if (outSize > maxBuffer) {
        return trip("maxBuffer", `la salida (stdout) de ${command} supero maxBuffer (${maxBuffer} bytes)`);
      }
      if (!ensureBudget(outSize + errSize)) {
        // El motivo es OTRO y se dice: culpar a `maxBuffer` cuando lo que se
        // agoto fue la capacidad global manda a mirar donde no es.
        return trip("presupuesto", `la captura de ${command} se corto: presupuesto global de memoria agotado`);
      }
      out.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      if (!acepta()) return;
      errSize += chunk.length;
      if (errSize > maxBuffer) {
        return trip("maxBuffer", `la salida (stderr) de ${command} supero maxBuffer (${maxBuffer} bytes)`);
      }
      if (!ensureBudget(outSize + errSize)) {
        return trip("presupuesto", `la captura de ${command} se corto: presupuesto global de memoria agotado`);
      }
      err.push(chunk);
    });

    child.on("error", (error) => settle({ ok: false, stdout: "", stderr: error.message, overflow }));
    // `exit` y `close` son el unico momento en que consta que el hijo murio, y
    // por tanto el unico en que el watchdog sobra.
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
