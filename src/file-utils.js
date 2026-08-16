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
// Techo de memoria de las capturas.
//
// El tope POR LLAMADA (`maxBuffer`) acota una captura sola. Hubo ademas un
// presupuesto GLOBAL compartido entre capturas concurrentes, y se quito: era
// la causa raiz de tres bloqueantes seguidos -- dos capturas con la MISMA
// entrada podian terminar distinto segun el orden de llegada de sus chunks,
// porque el presupuesto se consultaba a mitad de la escritura, con decisiones
// que dependian de CONTENIDO. Eso rompia la paridad sync/async, que es la
// propiedad que este modulo existe para sostener.
//
// Ronda 8 de revision adversarial encontro que quitarlo entero dejo el techo
// de diseño SIN CUMPLIR: `spawnCapture` es publica y no tenia tope de
// concurrencia propio. Medido: cinco capturas de 63 MiB en paralelo retuvieron
// 315 MiB con un pico de 497 MiB de RSS -- muy por encima de
// `CAPTURE_CEILING_BYTES`.
//
// La correccion NO reintroduce estado dependiente de bytes. `acquireCaptureSlot`
// / `releaseCaptureSlot` (mas abajo) son un semaforo FIFO que solo cuenta
// CAPTURAS EN VUELO, nunca su contenido. La diferencia con el presupuesto
// viejo es la que importa: aquel decidia A MITAD de la escritura, mirando
// bytes acumulados -- por eso dos llamadas identicas podian terminar distinto.
// Este decide UNA vez, al admitir la llamada, ANTES de que el hijo arranque.
// Una vez admitida, una captura se comporta exactamente igual este sola o en
// cola detras de otras cuatro: nada de lo que ve mientras corre depende de sus
// vecinas. Eso es lo que preserva la paridad sync/async y evita repetir el
// error de las rondas 5 y 6.
//
// El transitorio de decodificacion (`Buffer.concat` + `toString` + `split`)
// sigue fuera de esta cuenta y sigue declarado como limite conocido.
// ---------------------------------------------------------------------------

// Techo de diseño: cuanta memoria retenida se acepta con el pool caliente al
// completo. Lo hace cumplir `MAX_CONCURRENT_CAPTURES` (ver mas abajo): con esa
// cota de concurrencia y el tope por llamada, ninguna combinacion de capturas
// puede superarlo.
export const CAPTURE_CEILING_BYTES = 256 * 1024 * 1024;

// Concurrencia esperada del consumidor caliente. Es AUDIT_CONCURRENCY
// (harness.js), duplicado aqui porque harness.js importa de evidence-writer.js,
// que importaria de aqui: cerrar el ciclo importando el valor de vuelta no es
// posible. La prueba de paridad fija la relacion entre los dos numeros. Se usa
// ademas como cota REAL de concurrencia en `spawnCapture` (no solo como
// divisor): ver `MAX_CONCURRENT_CAPTURES`.
const EXPECTED_CONCURRENCY = 4;

// Techo por llamada del hash de arbol. Lo usan LAS DOS vias, la sincrona y la
// asincrona, y esa es toda la idea: mientras el numero sea el mismo, las dos
// aceptan y rechazan exactamente las mismas entradas.
//
// Cuanto es en la practica: `git ls-tree -r -z` gasta ~94 bytes por entrada
// (medido sobre este repo: 37 402 bytes / 399 archivos), asi que 64 MiB dan
// para ~715 000 archivos en un solo arbol. Esa media es de ESTE repo: rutas
// mas largas la suben y bajan el numero de archivos que caben.
//
// REGRESION DE CAPACIDAD REAL para arboles de entre 64 y 256 MiB (antes de
// 2.0.0 la via sincrona admitia 256 MiB). Ronda 8 de revision adversarial:
// `computeTreeHashAtRef`/`computeTreeHashAtRefAsync` (evidence-writer.js) no
// aceptaban un tope distinto -- un arbol mayor quedaba `tree-ref-unreadable`
// SIN FORMA de subirlo, ni siquiera para un repo que lo necesitara de verdad.
//
// `SDLC_TREE_HASH_MAX_BUFFER_BYTES` es el escape: se lee UNA vez, aqui, asi
// que las dos vias comparten automaticamente el mismo valor y no pueden
// divergir por ese lado (una API con un parametro POR FUNCION dejaria abierta
// la posibilidad de que alguien subiera solo una de las dos, que es la
// clase exacta de bug que motivo la ronda 6). Sin la variable, el default sigue
// siendo el mismo de siempre. Con ella, un valor invalido (no numerico, <= 0)
// tira al arrancar en vez de aceptarlo en silencio y decepcionar mas tarde.
// Exponerlo ademas como flag de CLI o campo de `.sdlc/config.json` sigue
// pendiente de decision de producto (docs/roadmap/pendientes-2.0.0.md); esta
// variable ya es usable hoy sin esperar esa decision.
function resolveTreeHashMaxBuffer() {
  const override = process.env.SDLC_TREE_HASH_MAX_BUFFER_BYTES;
  if (override === undefined) return Math.floor(CAPTURE_CEILING_BYTES / EXPECTED_CONCURRENCY);
  const parsed = Number(override);
  // `Number.isSafeInteger` y no `isFinite`: con `0.5` la version anterior pasaba
  // la guarda (0.5 > 0) y luego `Math.floor` publicaba un tope de CERO bytes --
  // un valor absurdo que hacia ilegible cualquier arbol. Lo encontro la ronda 9.
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new TypeError(
      `SDLC_TREE_HASH_MAX_BUFFER_BYTES tiene que ser un entero > 0, y llego "${override}"`
    );
  }
  // No puede pasar del techo: si una sola captura no cabe en el presupuesto, su
  // admision no se podria satisfacer NUNCA y colgaria a quien la pida.
  if (parsed > CAPTURE_CEILING_BYTES) {
    throw new TypeError(
      `SDLC_TREE_HASH_MAX_BUFFER_BYTES (${parsed}) no puede superar el techo de captura (${CAPTURE_CEILING_BYTES})`
    );
  }
  return parsed;
}
export const TREE_HASH_MAX_BUFFER = resolveTreeHashMaxBuffer();

// Presupuesto de admision, EN BYTES. Ronda 9 de revision adversarial: contar
// capturas en vez de bytes no hacia cumplir el techo, porque el tope por
// captura es configurable. Con el escape que el propio README documentaba
// (128 MiB), cuatro cupos daban 512 MiB -- el doble del techo que ese mismo
// commit afirmaba imponer. Medido: `potentialRetainedBytes: 536870912`.
//
// Ahora la admision reserva los bytes DECLARADOS de la captura. Sigue siendo
// una decision que se toma UNA vez, ANTES de arrancar el hijo, y solo sobre el
// tope declarado -- nunca sobre bytes ya recibidos. Esa es la linea que separa
// esto del presupuesto que se quito en la ronda 7: aquel consultaba a mitad de
// la escritura, con lo que dos llamadas identicas podian terminar distinto.
// Aqui, una vez admitida, una captura se comporta igual sola que en cola.
//
// (La ronda 5 midio que "reservar el maximo por adelantado" costaba 67 -> 99 ms
// por atestacion. Aquella medicion era con topes de 256 MiB, o sea el
// presupuesto entero por captura: se serializaba por fuerza. Con los 64 MiB de
// hoy caben cuatro a la vez y no se serializa nada; medido de nuevo mas abajo.)
let bytesReservados = 0;
const colaDeAdmision = [];

// Cuantas capturas del tamaño por defecto del hash de arbol caben a la vez.
// Se deriva, no se declara: si alguien sube el tope por captura, este numero
// baja solo y el techo se sigue cumpliendo.
export const MAX_CONCURRENT_CAPTURES = Math.max(1, Math.floor(CAPTURE_CEILING_BYTES / TREE_HASH_MAX_BUFFER));

// Admision FIFO por bytes declarados. Estrictamente FIFO: si la cabeza no cabe,
// nadie se cuela por detras aunque quepa. Permitir ese adelantamiento dejaba a
// la cabeza en inanicion indefinida bajo trafico continuo de capturas pequeñas
// -- ya nos paso en la ronda 4 con el presupuesto viejo.
function acquireCaptureSlot(bytes) {
  const necesita = Math.max(1, bytes); // una captura de 0 bytes tambien ocupa turno
  if (colaDeAdmision.length === 0 && bytesReservados + necesita <= CAPTURE_CEILING_BYTES) {
    bytesReservados += necesita;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    colaDeAdmision.push({ necesita, resolve });
  });
}

function releaseCaptureSlot(bytes) {
  bytesReservados -= Math.max(1, bytes);
  drenarAdmision();
}

function drenarAdmision() {
  // Solo la CABEZA. En cuanto una no cabe se para: es lo que hace que la cola
  // sea FIFO de verdad y no una subasta que favorece a las capturas pequeñas.
  while (colaDeAdmision.length > 0 && bytesReservados + colaDeAdmision[0].necesita <= CAPTURE_CEILING_BYTES) {
    const siguiente = colaDeAdmision.shift();
    bytesReservados += siguiente.necesita;
    siguiente.resolve();
  }
}

// Solo para pruebas y diagnostico.
export function captureQueueDepth() {
  return colaDeAdmision.length;
}
export function captureReservedBytes() {
  return bytesReservados;
}

// Tope de la fase de gracia entre el SIGTERM al grupo y el SIGKILL. Existe
// porque la escalada identifica al grupo por pgid, y un pgid solo sigue siendo
// el nuestro mientras la ventana sea corta.
//
// Bajado de 30 s a 5 s en la ronda 8 de revision adversarial: el argumento de
// "despreciable" no se sostenia con 30 s. `pid_max` es un valor de wrap
// CONFIGURABLE del kernel (no una garantia de esta libreria), y un consumidor
// con otra configuracion o namespace puede reciclarlo mucho antes de lo que
// esta libreria puede saber. 5 s (2.5x el default de 2000 ms) sigue dando
// margen de sobra para que un hijo que este cerrando de verdad lo haga, sin
// dejar una ventana que un argumento de probabilidad tenga que justificar caso
// por caso. El riesgo no se elimina -- cerrarlo de verdad pide una contencion
// del SO (cgroup, job object), no un pgid -- pero la ventana en la que puede
// materializarse es ahora seis veces mas corta.
export const MAX_KILL_GRACE_MS = 5_000;


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
 * LIMITE CONOCIDO: en Windows, `taskkill /T` recorre el arbol que reporta el
 * SO en el momento en que se invoca; un nieto REPARENTADO antes de esa
 * consulta puede escapar. En POSIX el nieto no escapa por esa via: la
 * escalada a SIGKILL fuerza el GRUPO al vencer `killGraceMs` sin mirar si el
 * lider ya salio (ronda 5 de revision adversarial -- antes, el `exit` del
 * lider cancelaba el watchdog y un nieto que ignorara SIGTERM sobrevivia para
 * siempre). Si el CLI se interrumpe (Ctrl-C) a mitad de una captura, el hijo
 * detached se limpia via `killAllActiveChildren` (registro + listener de
 * SIGINT/SIGTERM instalado una vez por proceso), no solo si la captura llega
 * a su propio corte por tiempo o tamaño. Sigue sin cubrirse: un descendiente
 * que se independiza de su grupo (`setsid()`) en cualquiera de las dos
 * plataformas.
 */
export async function spawnCapture(command, args, { cwd, maxBuffer = 1024 * 1024, killGraceMs = 2000 } = {}) {
  // Se valida antes de arrancar el hijo: un tope no finito o negativo no puede
  // cumplirse, y arrancar un proceso para matarlo acto seguido es peor que
  // fallar rapido. `0` es valido: significa "cualquier salida desborda".
  if (!Number.isFinite(maxBuffer) || maxBuffer < 0) {
    throw new TypeError(`maxBuffer tiene que ser un numero finito >= 0, y llego ${maxBuffer}`);
  }
  // La gracia tiene tope por seguridad, no por gusto: el SIGKILL de la escalada
  // va al GRUPO por pgid, y ese pgid solo sigue siendo el nuestro mientras la
  // ventana sea corta (ver el comentario del temporizador en `trip`). Una
  // gracia larga convierte un riesgo despreciable en uno real.
  if (!Number.isFinite(killGraceMs) || killGraceMs < 0 || killGraceMs > MAX_KILL_GRACE_MS) {
    throw new TypeError(`killGraceMs tiene que estar entre 0 y ${MAX_KILL_GRACE_MS} ms, y llego ${killGraceMs}`);
  }
  // Un tope mayor que el techo no se podria admitir jamas: colgaria a quien lo
  // pida en vez de fallar. Se rechaza aqui, con el numero delante.
  if (maxBuffer > CAPTURE_CEILING_BYTES) {
    throw new TypeError(
      `maxBuffer (${maxBuffer}) no puede superar el techo de captura (${CAPTURE_CEILING_BYTES}): ninguna admision podria satisfacerlo`
    );
  }
  // Se admite ANTES de arrancar el hijo, nunca durante: ver el bloque de
  // comentarios del presupuesto. Ronda 8: sin esto, cinco capturas de 63 MiB en
  // paralelo median 497 MiB de pico de RSS.
  //
  // NO hay `finally` que libere aqui, y es deliberado. Ronda 9: `trip()` resuelve
  // la promesa de inmediato y deja al hijo VIVO con sus buffers retenidos hasta
  // que cierre; liberar al resolver admitia una segunda tanda mientras la
  // primera seguia ocupando memoria de verdad (medido: ocho buffers a la vez).
  // El cupo lo suelta `captureProcess` en el momento en que los buffers se
  // sueltan de verdad. Es el MISMO error que ya se habia arreglado en la ronda 6
  // para el registro de hijos y que aqui se repitio con el presupuesto.
  await acquireCaptureSlot(maxBuffer);
  return captureProcess(command, args, { cwd, maxBuffer, killGraceMs });
}

// Terminar el ARBOL, no solo el hijo. `child.kill()` no alcanza a los nietos, y
// un nieto que herede los pipes puede retrasar la salida del proceso padre
// mucho despues de que la promesa haya resuelto.
function killTree(child) {
  if (process.platform === "win32") {
    // En Windows no hay grupos de procesos POSIX; `taskkill /T` recorre el
    // arbol. Se lanza y se olvida: es limpieza, no camino critico.
    try {
      const tk = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      // Sin este listener, un ENOENT (taskkill ausente del PATH: PATH
      // recortado, cuenta de servicio) llega ASINCRONO y el try/catch de
      // arriba no lo ve -- reproducido: revienta el proceso Node ENTERO con
      // un 'Unhandled error event', no solo deja nietos vivos. El fallback ya
      // corre incondicionalmente despues (`child.kill()`), asi que aqui solo
      // hace falta no dejar que el evento tumbe el proceso.
      tk.on("error", () => {});
      tk.unref();
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
      const tk = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      // Mismo defecto que en `killTree`. Aqui no hay fallback incondicional
      // despues: si `taskkill` no arranca, lo unico que queda es forzar al
      // menos al lider.
      tk.on("error", () => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ya se fue */
        }
      });
      tk.unref();
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ya se fue */
      }
    }
    return;
  }
  // IDENTIDAD ANTES DE MATAR. El pgid es el pid del lider, y un pid se recicla:
  // si el grupo murio limpio y el SO reasigno ese numero, un `kill(-pgid)`
  // caeria sobre un grupo AJENO. Es el riesgo que la revision adversarial marco
  // como SERIO durante dos rondas.
  //
  // Se cierra comprobando que el lider sigue siendo EL NUESTRO, no solo que
  // exista algo con ese numero: `/proc/<pid>/stat` trae el `starttime` (campo
  // 22), que junto al pid identifica una encarnacion concreta. Un pid reciclado
  // tiene otro `starttime`, asi que la comprobacion los distingue.
  const identidad = leerIdentidadDeProceso(child.pid);
  if (identidad && child.__sdlcStarttime && identidad.starttime !== child.__sdlcStarttime) {
    // El pid existe pero YA NO ES el nuestro: se reciclo. No se manda nada.
    return;
  }
  if (!identidad) {
    // Sin `/proc` legible (lider ya recogido, o un POSIX sin procfs) no se puede
    // probar identidad. Queda el sondeo con la señal 0, que al menos confirma
    // que el grupo existe antes de disparar. NO prueba que sea nuestro: es la
    // ventana residual, y esta declarada en docs/roadmap/pendientes-2.0.0.md.
    // Cerrarla del todo pide contencion del SO (cgroup, Job Object), que es un
    // slice propio y no un parche.
    try {
      process.kill(-child.pid, 0);
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ya se fue */
      }
      return;
    }
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

/**
 * Lee pgid y `starttime` de `/proc/<pid>/stat`. Devuelve `null` si no se puede
 * (Windows, un POSIX sin procfs, o un proceso que ya no existe).
 *
 * El nombre del ejecutable va entre parentesis y PUEDE CONTENER espacios y
 * parentesis, asi que los campos se cuentan a partir del ULTIMO `)`. Partir por
 * espacios desde el principio es el error clasico al leer este archivo.
 */
export function leerIdentidadDeProceso(pid) {
  if (process.platform === "win32" || !pid) return null;
  try {
    const crudo = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    const resto = crudo.slice(crudo.lastIndexOf(") ") + 2).split(" ");
    // Tras el `)`: [0]=state, [1]=ppid, [2]=pgrp ... el campo 22 global es [19].
    const pgid = Number(resto[2]);
    const starttime = resto[19];
    if (!Number.isFinite(pgid) || !starttime) return null;
    return { pgid, starttime };
  } catch {
    return null;
  }
}

// Registro de hijos DETACHED en vuelo (POSIX unicamente: en Windows no se
// detacha, ver mas abajo). `detached: true` pone al hijo en su PROPIO grupo de
// procesos -- Ctrl-C en la terminal señala al grupo ORIGINAL de Node, no a
// este grupo nuevo. Si Node termina sin limpiar explicitamente, el hijo -y sus
// descendientes: un `git`/GPG de verificacion, o un `pinentry` esperando
// entrada que ya nadie va a dar- puede quedar huerfano y vivo.
const activeChildren = new Set();

/**
 * Fuerza el arbol de TODOS los hijos detached que sigan en vuelo. Separada de
 * los listeners de señal para poder probarla directamente: mandar la señal de
 * verdad al proceso de la prueba lo terminaria a el tambien, antes de poder
 * afirmar nada.
 */
export function killAllActiveChildren() {
  for (const child of activeChildren) {
    try {
      killTreeForce(child);
    } catch {
      /* best effort: un hijo no puede impedir que se limpien los demas */
    }
  }
}

let signalHandlersInstalled = false;

function installSignalCleanupOnce() {
  if (signalHandlersInstalled) return;
  signalHandlersInstalled = true;
  // Node deja de auto-salir con SIGINT/SIGTERM en cuanto se registra un
  // listener propio; se replica la salida por defecto (128 + numero de señal)
  // despues de limpiar, para no cambiar el codigo de salida que ya esperaba
  // quien invoca el CLI.
  process.on("SIGINT", () => {
    killAllActiveChildren();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    killAllActiveChildren();
    process.exit(143);
  });
  // Red de seguridad para la salida NORMAL. El temporizador de escalada esta
  // `unref`-ado a proposito (no debe retrasar la salida del CLI), asi que si
  // el proceso termina antes de que venza la gracia, ese SIGKILL no llega a
  // correr y el grupo quedaria huerfano. `process.kill` es sincrono, que es lo
  // unico que un handler de `exit` puede hacer.
  process.on("exit", killAllActiveChildren);
}

function captureProcess(command, args, { cwd, maxBuffer, killGraceMs }) {
  return new Promise((resolve) => {
    // `detached` en POSIX crea grupo de procesos propio, que es lo que permite
    // matar a los nietos. En Windows no aplica y se usa `taskkill /T`.
    const detached = process.platform !== "win32";
    let child;
    try {
      child = spawn(command, args, { cwd, detached });
    } catch (error) {
      // `spawn` puede tirar SINCRONAMENTE con argumentos invalidos (un comando
      // vacio, por ejemplo), antes de que exista `child` y antes de que se
      // registre `liberarMemoria`. Sin esto, el cupo ya reservado no lo
      // devolvia NADIE: medido, un `spawnCapture("", [])` con el tope entero
      // dejaba 268 435 456 bytes reservados para siempre y colgaba toda captura
      // posterior. Lo encontro la ronda 10.
      //
      // Es la misma familia de defecto que ya aparecio dos veces en este
      // archivo: reservar algo y salir por un camino que no lo libera. Por eso
      // la liberacion vive AQUI, en el mismo sitio que la adquisicion decide
      // proteger, y no en un `finally` del llamador -- un `finally` liberaria
      // tambien al RESOLVER, que es justo el bug de la ronda 9.
      releaseCaptureSlot(maxBuffer);
      throw error; // dentro del executor: rechaza la promesa, como antes
    }
    if (detached) {
      installSignalCleanupOnce();
      activeChildren.add(child);
      // Se anota la ENCARNACION del lider, no solo su pid: `starttime` + pid
      // identifican un proceso concreto, y un pid reciclado trae otro
      // `starttime`. Es lo que permite a `killTreeForce` no disparar sobre un
      // grupo ajeno. Se lee AQUI, con el hijo recien nacido y seguro vivo --
      // hacerlo en la escalada seria tarde: para entonces puede estar recogido.
      const identidad = leerIdentidadDeProceso(child.pid);
      if (identidad) child.__sdlcStarttime = identidad.starttime;
    }
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

    // Sale del registro de limpieza SOLO cuando consta que el hijo murio
    // (`close`) o que nunca arranco (`error`). NO al resolver la promesa:
    // `trip()` resuelve de inmediato y deja al hijo vivo durante toda la
    // ventana de `killGraceMs` -- justo el caso en que ya sabemos que
    // resistio el SIGTERM. Darlo de baja ahi lo dejaba fuera del alcance de
    // `killAllActiveChildren`, y un Ctrl-C en esa ventana orfanaba el grupo.
    const desregistrar = () => activeChildren.delete(child);

    // Suelta los buffers Y el cupo del presupuesto, exactamente a la vez y una
    // sola vez. Atarlos es el punto: el presupuesto mide MEMORIA RETENIDA, asi
    // que devolverlo antes de soltar los buffers es mentir sobre lo que hay
    // ocupado. Ronda 9 midio esa mentira -- se admitia una segunda tanda
    // mientras la primera seguia reteniendo.
    let liberado = false;
    const liberarMemoria = () => {
      if (liberado) return;
      liberado = true;
      out.length = 0;
      err.length = 0;
      releaseCaptureSlot(maxBuffer);
    };

    const trip = (motivo, detalle) => {
      if (overflow) return;
      overflow = true;
      // Los buffers acumulados NO se devuelven en un corte (`stdout: ""`), asi
      // que se sueltan ya mismo en vez de esperar a `close`. Eso libera memoria
      // de verdad y, con ella, el cupo: un hijo que resista el SIGTERM ya no
      // bloquea el presupuesto durante toda la gracia, porque a partir de aqui
      // `acepta()` es falso y no va a acumular nada mas.
      liberarMemoria();
      // Se resuelve YA, sin esperar a `close`: matar no garantiza que el hijo
      // muera, y esperarlo dejaria la promesa —y el hueco del pool— colgada.
      killTree(child);
      // Este temporizador NO SE CANCELA NUNCA, ni por `exit` ni por `close`.
      // Las dos rondas anteriores se equivocaron aqui, cada una a su manera:
      //   - cancelar con `exit` mira solo al LIDER, y `killTree` mato al GRUPO;
      //   - cancelar con `close` parecia la correccion, y no lo era: `close`
      //     dispara en cuanto se cierran los pipes DEL LIDER, cosa que ocurre
      //     al morir el lider si ningun descendiente los heredo (un nieto
      //     lanzado con `stdio: 'ignore'` es el caso normal). Reproducido en
      //     POSIX: el nieto seguia vivo a t=1025 ms con `killGraceMs` de 300,
      //     y un `kill(-pgid, SIGKILL)` a mano lo mataba sin problema.
      // Ningun evento del lider prueba que el GRUPO este vacio, asi que la
      // escalada corre siempre. Forzar un grupo ya vacio es inofensivo (ESRCH,
      // capturado en `killTreeForce`).
      //
      // RIESGO ACEPTADO, no resuelto: si el grupo SI murio limpio y el SO
      // recicla ese pgid dentro de la ventana de gracia, este SIGKILL cae
      // sobre un grupo ajeno. Para que ocurra, el SO tiene que dar la vuelta
      // al espacio de PIDs entero DENTRO de la gracia y aterrizar justo en
      // este numero. Se acepta porque la alternativa -no escalar- deja
      // descendientes de git/GPG vivos indefinidamente: fallo frecuente y
      // seguro frente a uno improbable. Cerrarlo de verdad pide una contencion
      // del SO (cgroup, job object), no un pgid.
      //
      // Ese argumento SOLO vale con una gracia corta, asi que la gracia esta
      // acotada arriba (`MAX_KILL_GRACE_MS`): sin tope, quien pasara diez
      // minutos convertiria un riesgo despreciable en uno real, y la
      // justificacion escrita aqui dejaria de sostenerse sin que nadie lo
      // notara.
      killTimer = setTimeout(() => {
        killTimer = null;
        killTreeForce(child);
        desregistrar();
      }, killGraceMs);
      killTimer.unref?.();
      settle({ ok: false, stdout: "", stderr: detalle, overflow: true, reason: motivo });
    };

    // Tras un corte los listeners SIGUEN vivos hasta que el hijo cierre: todo
    // lo que llegue despues se descarta en vez de seguir acumulandose.
    const acepta = () => !settled && !overflow;

    child.stdout.on("data", (chunk) => {
      if (!acepta()) return;
      outSize += chunk.length;
      // COMBINADO, no por stream: `spawnSync` gasta un solo `maxBuffer` entre
      // stdout y stderr. Medido (ronda 7): con maxBuffer de 10 MiB y 6 MiB por
      // cada stream, `spawnSync` da ENOBUFS y entrega stderr truncado a
      // 4 259 840 B -- justo 10 MiB entre los dos. Limitar aqui cada stream por
      // separado aceptaba entradas que la via sincrona rechazaba: el mismo
      // sujeto, dos veredictos, que es exactamente lo que este modulo existe
      // para impedir.
      if (outSize + errSize > maxBuffer) {
        return trip("maxBuffer", `la salida (stdout) de ${command} supero maxBuffer (${maxBuffer} bytes contando stdout+stderr, como spawnSync)`);
      }
      out.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      if (!acepta()) return;
      errSize += chunk.length;
      // Combinado con stdout, igual que arriba y que `spawnSync`.
      if (outSize + errSize > maxBuffer) {
        return trip("maxBuffer", `la salida (stderr) de ${command} supero maxBuffer (${maxBuffer} bytes contando stdout+stderr, como spawnSync)`);
      }
      err.push(chunk);
    });

    child.on("error", (error) => {
      desregistrar(); // nunca arranco: no hay grupo que limpiar
      liberarMemoria();
      settle({ ok: false, stdout: "", stderr: error.message, overflow });
    });
    // `close` da de baja al lider del registro de limpieza, pero NO cancela la
    // escalada: cierra los pipes DEL LIDER, y eso no dice nada del resto del
    // grupo (ver el comentario del temporizador en `trip`). Si hubo corte, el
    // SIGKILL al grupo corre igual al vencer la gracia.
    child.on("close", (code) => {
      if (!killTimer) desregistrar();
      // Se decodifica ANTES de soltar los buffers, obviamente; el cupo se
      // devuelve justo despues, que es cuando la memoria deja de estar
      // retenida de verdad. En el camino normal `close` es el primer momento
      // en que eso es cierto.
      const resultado = {
        ok: code === 0,
        stdout: decodeCapture(out),
        stderr: decodeCapture(err),
        overflow: false
      };
      liberarMemoria();
      settle(resultado);
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
  //
  // `.codex-out` es exactamente la misma categoria: transcripciones y hallazgos
  // de las revisiones adversariales (`scripts/codex-review.mjs`). Estan
  // gitignoradas y llenas de rutas absolutas de la maquina, asi que escanearlas
  // hace fallar `validate-no-personal-paths` por desarrollo local.
  const ignored =
    options.ignored ?? new Set([".git", "node_modules", ".turbo", "dist", "coverage", ".sdlc", ".codex-out"]);
  const results = [];

  function walk(current) {
    if (!pathExists(current)) {
      return;
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (ignored.has(entry.name)) {
        continue;
      }
      // `.claude/worktrees/` son worktrees de git creados DENTRO del repo por
      // agentes en paralelo: cada uno es una COPIA completa del arbol. Sin esta
      // regla, cualquier worktree vivo duplica todos los archivos del repo ante
      // los validadores y `validate-template-sanitization` falla nombrando
      // rutas que el desarrollador no reconoce. Se compara la RUTA, no solo el
      // nombre: un directorio `worktrees/` en cualquier otro sitio si es
      // contenido del repo.
      if (entry.isDirectory() && entry.name === "worktrees" && path.basename(current) === ".claude") {
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
