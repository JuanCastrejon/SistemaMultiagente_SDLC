// ---------------------------------------------------------------------------
// Paridad entre la ruta SINCRONA y la ASINCRONA de verificacion.
//
// Existen dos porque la auditoria necesita paralelismo y `spawnSync` bloquea el
// hilo. El riesgo de tener dos es que diverjan: si la auditoria juzga distinto
// que el gate, el desacuerdo no se ve — las dos dicen "verificado" y una de las
// dos miente.
//
// Estos casos son los que una revision adversarial señalo como frontera real, y
// dos de ellos eran defectos ciertos cuando se escribieron:
//   - `stdout += chunk` decodifica cada trozo por separado y parte los
//     caracteres UTF-8 que caen entre dos chunks;
//   - la via async no tenia el `maxBuffer` que `spawnSync` aplica por defecto,
//     asi que la misma entrada podia fallar en un camino y pasar en el otro.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { AUDIT_CONCURRENCY as HARNESS_AUDIT_CONCURRENCY } from "../src/harness.js";
import { DEFAULT_BUDGET_BYTES, TREE_HASH_MAX_BUFFER, createCaptureBudget, decodeCapture, spawnCapture } from "../src/file-utils.js";
import { computeTreeHashAtRef, computeTreeHashAtRefAsync } from "../src/evidence-writer.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-parity-"));

// --- 1. UTF-8 partido entre chunks -----------------------------------------
// DOS pruebas, porque una sola no bastaba. La de proceso real depende de como
// el runtime trocee la salida, asi que como prueba de REGRESION no es fiable:
// una implementacion rota puede pasar si los cortes caen alineados. La
// determinista ataca el helper puro con cortes elegidos a mano, y esa si falla
// siempre con el codigo viejo.
{
  // Determinista: 'A' con tilde son dos bytes; se parten a proposito.
  const acentuado = Buffer.from("Ángel — atestación", "utf8");
  const trozos = [acentuado.subarray(0, 1), acentuado.subarray(1)];
  assert.equal(decodeCapture(trozos), "Ángel — atestación", "decodificar una vez sobre el buffer completo conserva el caracter");
  // Y asi es como fallaba: decodificando cada trozo por separado.
  const ingenuo = trozos.map((t) => t.toString()).join("");
  assert.notEqual(ingenuo, "Ángel — atestación", "la concatenacion de strings SI corrompe: es el bug que se arreglo");
  assert.ok(ingenuo.includes("�"), "y deja caracteres de reemplazo");
}

{
  // Proceso real: '€' son 3 bytes y 65536 no es multiplo de 3, asi que con
  // chunks de 64 KiB el corte cae dentro del caracter.
  const script = path.join(tempRoot, "emit.mjs");
  fs.writeFileSync(script, "process.stdout.write('€'.repeat(120000));", "utf8");

  const sync = spawnSync(process.execPath, [script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const async_ = await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024 * 1024 });

  assert.equal(async_.ok, true);
  assert.equal(async_.stdout, sync.stdout, "async y sync tienen que producir EXACTAMENTE el mismo texto");
  assert.equal(async_.stdout.length, 120000, "ni un caracter de mas ni de menos");
  assert.ok(!async_.stdout.includes("�"), "ningun caracter de reemplazo");
}

console.log("paridad utf-8 entre chunks: PASS");

// --- 2. limite de tamaño: mismo criterio en las dos vias --------------------
// `spawnSync` falla con ENOBUFS al pasarse de `maxBuffer`. Si la via async no
// lo aplicara, la misma entrada pasaria por un camino y fallaria por el otro.
{
  const script = path.join(tempRoot, "grande.mjs");
  fs.writeFileSync(script, "process.stdout.write('x'.repeat(2 * 1024 * 1024));", "utf8");

  const sync = spawnSync(process.execPath, [script], { encoding: "utf8" });
  const async_ = await spawnCapture(process.execPath, [script]);

  assert.notEqual(sync.status, 0, "spawnSync tiene que fallar por maxBuffer");
  assert.equal(async_.ok, false, "la via async tiene que fallar tambien, no aceptar en silencio");
  assert.equal(async_.overflow, true);
  assert.match(async_.stderr, /maxBuffer/);
}

console.log("paridad de limite de salida: PASS");

// --- 3. hash de arbol: los dos caminos dan el MISMO hash --------------------
{
  const repo = path.join(tempRoot, "repo");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git(["init", "--quiet"]);
  git(["config", "user.email", "parity@example.com"]);
  git(["config", "user.name", "Parity"]);
  // Nombres con tilde a proposito: es donde el bug de decodificacion se veria.
  fs.writeFileSync(path.join(repo, "src", "índice.js"), "export const a = 1;\n", "utf8");
  fs.writeFileSync(path.join(repo, "src", "conexión.js"), "export const b = 2;\n", "utf8");
  for (let i = 0; i < 120; i += 1) {
    fs.writeFileSync(path.join(repo, "src", `mod-${i}.js`), `export const v${i} = ${i};\n`, "utf8");
  }
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "base"]);

  const sync = computeTreeHashAtRef(repo, ["src"], "HEAD");
  const async_ = await computeTreeHashAtRefAsync(repo, ["src"], "HEAD");
  assert.equal(sync.ok, true);
  assert.equal(async_.ok, true);
  assert.equal(async_.hash, sync.hash, "el hash del arbol no puede depender de por que via se calculo");
  assert.equal(async_.files, sync.files);

  // Y un ref que no existe falla igual por los dos caminos.
  const syncMal = computeTreeHashAtRef(repo, ["src"], "no-existe");
  const asyncMal = await computeTreeHashAtRefAsync(repo, ["src"], "no-existe");
  assert.equal(syncMal.ok, false);
  assert.equal(asyncMal.ok, false);
  assert.equal(asyncMal.code, syncMal.code);
}

console.log("paridad de hash de arbol: PASS");

// --- 4. el pool: excepcion, tope de concurrencia y orden -------------------
{
  const { runPool, AUDIT_CONCURRENCY } = await import("../src/harness.js");
  assert.equal(AUDIT_CONCURRENCY, 4, "el tope declarado es 4; cambiarlo es una decision, no un accidente");

  // Una tarea que revienta NO puede matar el informe entero ni dejar corredores
  // trabajando en segundo plano sobre algo que ya nadie va a leer.
  const items = Array.from({ length: 12 }, (_, i) => i);
  let enVuelo = 0;
  let maximoSimultaneo = 0;

  const resultados = await runPool(items, async (item) => {
    enVuelo += 1;
    maximoSimultaneo = Math.max(maximoSimultaneo, enVuelo);
    await new Promise((resolve) => setTimeout(resolve, 5));
    enVuelo -= 1;
    if (item === 3) throw new Error("boom");
    return { ok: true, item };
  });

  assert.equal(resultados.length, 12, "no se pierde ninguna tarea aunque una reviente");
  assert.equal(resultados[3].ok, false, "la que revienta se convierte en veredicto fail-closed");
  assert.equal(resultados[3].code, "attestation-audit-failed");
  assert.match(resultados[3].detail, /boom/, "el motivo real llega hasta el hallazgo");
  assert.ok(
    resultados.filter((r) => r.ok).length === 11,
    "las once restantes se completan: una atestacion rota no invalida el resto del informe"
  );

  // El orden de la salida es el de ENTRADA, no el de terminacion.
  assert.deepEqual(
    resultados.filter((r) => r.ok).map((r) => r.item),
    items.filter((i) => i !== 3),
    "los resultados conservan el orden de entrada"
  );

  assert.ok(maximoSimultaneo <= AUDIT_CONCURRENCY, `nunca mas de ${AUDIT_CONCURRENCY} a la vez: hubo ${maximoSimultaneo}`);
  assert.ok(maximoSimultaneo > 1, "y de verdad concurre: con 1 no habria paralelismo");
}

console.log("pool: excepcion aislada, tope y orden: PASS");

// --- 5. stderr tambien tiene tope ------------------------------------------
// `maxBuffer` en Node se aplica a stdout O stderr. Limitar solo el primero
// dejaba que un hijo ruidoso por stderr devolviera `ok:true` mientras
// `spawnSync` fallaba con ENOBUFS: las dos vias divergian otra vez, y la
// acumulacion sin tope era via de agotar memoria.
{
  const script = path.join(tempRoot, "ruidoso.mjs");
  fs.writeFileSync(script, "process.stderr.write('e'.repeat(2 * 1024 * 1024));", "utf8");

  const sync = spawnSync(process.execPath, [script], { encoding: "utf8" });
  const async_ = await spawnCapture(process.execPath, [script]);

  assert.notEqual(sync.status, 0, "spawnSync falla por maxBuffer de stderr");
  assert.equal(async_.ok, false, "la via async tiene que fallar igual");
  assert.equal(async_.overflow, true);
  assert.match(async_.stderr, /stderr/, "el motivo dice por que stream se desbordo");
}

console.log("tope de stderr: PASS");

// --- 5b. `maxBuffer` es UN presupuesto entre los dos streams ---------------
// BLOQUEANTE de la ronda 7. `spawnSync` gasta un solo `maxBuffer` entre stdout
// y stderr; `spawnCapture` los limitaba por separado. Con 6 MiB por stream y
// un tope de 10 MiB, la via sincrona daba ENOBUFS y la asincrona aceptaba: el
// mismo sujeto, dos veredictos. Se prueba por COMPARACION DIRECTA entre las
// dos vias, que es la unica forma de que no vuelvan a divergir en silencio.
{
  const script = path.join(tempRoot, "dos-streams.mjs");
  fs.writeFileSync(
    script,
    [
      "process.stdout.write('o'.repeat(6 * 1024 * 1024));",
      "process.stderr.write('e'.repeat(6 * 1024 * 1024));"
    ].join("\n"),
    "utf8"
  );

  // Ninguno de los dos streams supera el tope por si solo (6 < 10); juntos, si.
  const maxBuffer = 10 * 1024 * 1024;
  const sync = spawnSync(process.execPath, [script], { maxBuffer, encoding: "buffer" });
  const async_ = await spawnCapture(process.execPath, [script], { maxBuffer });

  assert.ok(sync.error, "spawnSync corta con ENOBUFS: gasta UN presupuesto entre los dos streams");
  assert.equal(sync.error.code, "ENOBUFS");
  assert.equal(
    async_.ok,
    false,
    "la via async tiene que cortar TAMBIEN: si limita cada stream por separado, acepta lo que la sincrona rechaza"
  );
  assert.equal(async_.overflow, true);
  assert.equal(async_.reason, "maxBuffer");
}

console.log("maxBuffer combinado entre stdout y stderr: PASS");

// --- 6. un hijo que ignora SIGTERM no cuelga la promesa --------------------
// `kill()` manda SIGTERM y no garantiza nada. Si `spawnCapture` esperara a
// `close` para resolver, un hijo que lo ignore dejaria la promesa colgada para
// siempre — y con ella el hueco del pool.
{
  const script = path.join(tempRoot, "terco.mjs");
  fs.writeFileSync(
    script,
    [
      "process.on('SIGTERM', () => {});",
      "process.stdout.write('x'.repeat(2 * 1024 * 1024));",
      // Se queda vivo a proposito despues de desbordar.
      "setTimeout(() => {}, 60000);"
    ].join("\n"),
    "utf8"
  );

  const t0 = Date.now();
  const resultado = await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024, killGraceMs: 200 });
  const transcurrido = Date.now() - t0;

  assert.equal(resultado.ok, false);
  assert.equal(resultado.overflow, true);
  assert.ok(transcurrido < 10_000, `tiene que resolver sin esperar al hijo: tardo ${transcurrido} ms`);
}

// En Windows este caso NO prueba lo que su nombre dice: alli SIGTERM no es una
// señal real y Node termina el proceso a la fuerza, asi que el hijo nunca llega
// a ignorarla. Lo que si valida en ambas plataformas es que `spawnCapture`
// resuelve sin esperar al hijo. La sobrevivencia al SIGTERM y la escalada a
// SIGKILL solo se ejercitan de verdad en POSIX.
console.log(
  process.platform === "win32"
    ? "resolucion sin esperar al hijo: PASS (en Windows SIGTERM no es evitable; la escalada no se ejercita)"
    : "hijo que ignora SIGTERM: PASS"
);

// --- 7. el orden lo produce el CODIGO, no el test --------------------------
// La version anterior de este caso ordenaba dos arrays locales y los comparaba:
// habria pasado igual si `auditAttestations` volviera a usar `localeCompare`.
// Un test que no ejercita el codigo no protege nada. Ahora se crea evidencia
// real con nombres que ordenan DISTINTO por locale y por bytes, y se comprueba
// el orden de los hallazgos que devuelve la funcion.
{
  const repo = path.join(tempRoot, "orden");
  fs.mkdirSync(path.join(repo, "src"), { recursive: true });
  const git = (args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" });
  git(["init", "--quiet"]);
  git(["config", "user.email", "orden@example.com"]);
  git(["config", "user.name", "Orden"]);
  fs.writeFileSync(path.join(repo, "src", "index.js"), "export const x = 1;\n", "utf8");
  fs.writeFileSync(
    path.join(repo, "quality-contract.yaml"),
    "version: 1\nenforcement: observe\ntiers:\n  core:\n    description: t\nsurfaces:\n  - id: s\n    path: src\n    tier: core\nprobes: []\ngates: []\n",
    "utf8"
  );
  fs.mkdirSync(path.join(repo, ".sdlc"), { recursive: true });
  fs.writeFileSync(
    path.join(repo, ".sdlc", "config.json"),
    JSON.stringify({ schemaVersion: 1, project: { name: "O", slug: "o" }, surfaces: [], governance: { maintainers: [{ signer: "x@example.com" }] } }),
    "utf8"
  );

  // "Z" y "a" ordenan al reves por bytes que por locale ingles, y la eñe
  // desempata a la vez el caso no-ASCII.
  const slices = ["a-slice", "Z-slice", "ñ-slice"];
  for (const slice of slices) {
    const dir = path.join(repo, ".github", "agent-state", "evidence", slice);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "F13.yaml"),
      YAML.stringify({
        phase: "F13",
        slice,
        agent_id: "t",
        started_at: new Date(0).toISOString(),
        outputs: [],
        validators_run: [],
        // Commit inexistente: da hallazgo sin necesitar firma real, que es lo
        // que este caso quiere observar — el ORDEN, no la verificacion.
        human_gate_signoff: { required: true, approved_by: "x", attestation_commit: "0".repeat(40) }
      }),
      "utf8"
    );
  }
  git(["add", "."]);
  git(["commit", "--quiet", "-m", "base"]);

  const { auditAttestations } = await import("../src/harness.js");
  const resultado = await auditAttestations(repo);
  const orden = resultado.findings.map((f) => f.slice);

  const porBytes = [...slices].sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
  assert.deepEqual(orden, porBytes, "los hallazgos salen en orden de bytes UTF-8");

  // El orden esperado se escribe LITERAL, no derivado de otra ordenacion: si se
  // compara contra `localeCompare`, el propio test pasa a depender del locale
  // que intenta descartar.
  assert.deepEqual(orden, ["Z-slice", "a-slice", "ñ-slice"], "orden por bytes UTF-8, escrito a mano");
}

console.log("orden de hallazgos por bytes: PASS");

// --- 8. la fuga de presupuesto tras un corte -------------------------------
// Tras `trip()` la promesa resuelve y el `finally` devuelve la reserva, pero los
// listeners SIGUEN vivos hasta que el hijo cierre. Un chunk tardio del otro
// stream volvia a crecer el ledger y descontaba presupuesto que ya nadie iba a
// devolver: fuga PERMANENTE, y la cola esperando para siempre. Se prueba con un
// presupuesto pequeño inyectado, sin generar cientos de MiB.
{
  const budget = createCaptureBudget(4 * 1024 * 1024);
  const antes = budget.availableBytes();

  const script = path.join(tempRoot, "tardio.mjs");
  fs.writeFileSync(
    script,
    [
      // Desborda por stdout y DESPUES sigue escribiendo por stderr.
      "process.stdout.write('x'.repeat(300 * 1024));",
      "let n = 0;",
      "const t = setInterval(() => { process.stderr.write('e'.repeat(64 * 1024)); if (++n > 20) { clearInterval(t); } }, 5);"
    ].join("\n"),
    "utf8"
  );

  const resultado = await spawnCapture(process.execPath, [script], { maxBuffer: 128 * 1024, killGraceMs: 200, budget });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.overflow, true);

  // Se da tiempo a que lleguen los chunks tardios que antes provocaban la fuga.
  await new Promise((resolve) => setTimeout(resolve, 400));

  assert.equal(budget.availableBytes(), antes, "el presupuesto vuelve INTACTO: ni un byte perdido tras el corte");
  assert.equal(budget.waiting(), 0, "y nadie se queda esperando en la cola");
}

console.log("sin fuga de presupuesto tras corte: PASS");

// --- 9. el motivo del corte no miente --------------------------------------
{
  const budget = createCaptureBudget(64 * 1024);
  const script = path.join(tempRoot, "mediano.mjs");
  fs.writeFileSync(script, "process.stdout.write('y'.repeat(2 * 1024 * 1024));", "utf8");

  // maxBuffer holgado: lo que se agota es el presupuesto GLOBAL, y el mensaje
  // tiene que decir eso y no acusar a maxBuffer.
  const resultado = await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024 * 1024, killGraceMs: 200, budget });
  assert.equal(resultado.ok, false);
  assert.equal(resultado.reason, "presupuesto");
  assert.match(resultado.stderr, /presupuesto global/);
}

console.log("motivo del corte correcto: PASS");

// --- 10. sin barging: quien llega despues no se cuela ----------------------
// Permitir que una captura pequeña adquiriera presupuesto habiendo alguien en
// cola dejaba a la cabeza en inanicion indefinida bajo trafico continuo.
{
  const budget = createCaptureBudget(10 * 1024 * 1024);
  const primera = budget.acquire(8 * 1024 * 1024);
  assert.equal(primera.wait, null, "la primera cabe");

  const segunda = budget.acquire(8 * 1024 * 1024);
  assert.ok(segunda.wait, "la segunda no cabe y espera");

  const tercera = budget.acquire(1024);
  assert.ok(tercera.wait, "la tercera cabria por tamaño, pero hay cola: no se cuela");

  budget.release(primera.need);
  await segunda.wait;
  budget.release(segunda.need);
  await tercera.wait;
  budget.release(tercera.need);
  assert.equal(budget.availableBytes(), budget.total, "todo devuelto");
}

console.log("cola sin barging: PASS");

// --- 11. maxBuffer invalido se rechaza antes de tocar nada -----------------
{
  const budget = createCaptureBudget(1024 * 1024);
  for (const malo of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    await assert.rejects(
      () => spawnCapture(process.execPath, ["-e", "0"], { maxBuffer: malo, budget }),
      /maxBuffer/,
      `${malo} tiene que rechazarse`
    );
  }
  assert.equal(budget.availableBytes(), budget.total, "un rechazo no puede descuadrar el contador");
}

console.log("validacion de maxBuffer: PASS");

// --- 12. paridad bajo carga: el veredicto ya no lo decide una carrera ------
// BLOQUEANTE de la ronda 5 de revision adversarial. `computeTreeHashAtRefAsync`
// pasaba el presupuesto GLOBAL entero como tope POR LLAMADA; con
// AUDIT_CONCURRENCY en vuelo a la vez, la primera en crecer podia agotarlo
// para las otras tres. Reproducido: con un presupuesto de 64 MiB, tope SIN
// dividir y cuatro capturas de 20 MiB en paralelo, el resultado cambiaba de
// corrida en corrida -- ["presupuesto","ok","ok","presupuesto"], luego
// ["presupuesto","presupuesto","ok","ok"] -- la MISMA entrada, veredictos
// distintos segun quien ganara la carrera de memoria.
{
  // La relacion entre los dos numeros vive partida en dos archivos porque
  // evidence-writer.js no puede importar AUDIT_CONCURRENCY de harness.js sin
  // cerrar un ciclo (harness.js ya importa de evidence-writer.js). Esta
  // asercion es lo que evita que diverjan sin que nadie se entere.
  assert.equal(
    TREE_HASH_MAX_BUFFER * HARNESS_AUDIT_CONCURRENCY,
    DEFAULT_BUDGET_BYTES,
    "TREE_HASH_MAX_BUFFER tiene que ser DEFAULT_BUDGET_BYTES / AUDIT_CONCURRENCY exacto"
  );

  // LAS DOS vias tienen que declarar el MISMO tope. La ronda 6 encontro que
  // bajar solo la asincrona a presupuesto/4 no arreglaba la divergencia: la
  // volvia determinista. Un `ls-tree` de entre 64 y 256 MiB pasaba por la via
  // sincrona y fallaba SIEMPRE por la asincrona. Se comprueba leyendo el
  // codigo porque el desacuerdo esta en las DECLARACIONES, y montar un arbol
  // real de 64 MiB en una prueba costaria minutos.
  const fuente = fs.readFileSync(new URL("../src/evidence-writer.js", import.meta.url), "utf8");
  const topes = [...fuente.matchAll(/maxBuffer:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(topes.length >= 2, `se esperaban las dos vias del hash de arbol declarando tope, y se vieron ${topes.length}`);
  assert.deepEqual(
    [...new Set(topes)],
    ["TREE_HASH_MAX_BUFFER"],
    `las dos vias tienen que declarar EL MISMO tope y ser TREE_HASH_MAX_BUFFER; se vio ${JSON.stringify(topes)}`
  );

  const dir = fs.mkdtempSync(path.join(tempRoot, "paridad-pool-"));
  const script = path.join(dir, "lento.mjs");
  // Escritura PACEADA: streaming real, no un solo `write` que termina antes de
  // que las otras tres capturas lleguen a competir por el mismo presupuesto.
  // 20 MiB por proceso, a proposito POR ENCIMA de la cuota justa (16 MiB con
  // este presupuesto de prueba): asi el desenlace deja de depender del
  // presupuesto COMPARTIDO (racy) y pasa a depender solo del tope INDIVIDUAL
  // (determinista), que es exactamente la propiedad que este fix entrega.
  fs.writeFileSync(
    script,
    [
      "const b = Buffer.alloc(1024 * 1024, 0x61);",
      "let i = 0;",
      "const t = setInterval(() => { if (i++ >= 20) { clearInterval(t); return; } process.stdout.write(b); }, 4);"
    ].join("\n"),
    "utf8"
  );

  for (let intento = 1; intento <= 3; intento += 1) {
    const budget = createCaptureBudget(64 * 1024 * 1024);
    const cuotaJusta = Math.floor(budget.total / 4);
    const resultados = await Promise.all(
      Array.from({ length: 4 }, () => spawnCapture(process.execPath, [script], { maxBuffer: cuotaJusta, killGraceMs: 500, budget }))
    );
    assert.deepEqual(
      resultados.map((r) => r.reason),
      ["maxBuffer", "maxBuffer", "maxBuffer", "maxBuffer"],
      `intento ${intento}: las cuatro tienen que cortar por su propio tope, SIEMPRE la misma razon -- no por una carrera de presupuesto compartido`
    );
    assert.equal(budget.availableBytes(), budget.total, `intento ${intento}: el presupuesto vuelve completo`);
  }
}

console.log("paridad bajo carga del pool: PASS");

// --- 13. el watchdog fuerza el GRUPO aunque el lider ya haya salido --------
// BLOQUEANTE de la ronda 5. El lider muere por el SIGTERM del propio corte
// mientras un DESCENDIENTE que hereda el grupo lo ignora y sigue vivo: antes
// de este fix, `child.on("exit", cancelWatchdog)` desarmaba la escalada en
// cuanto el lider salia, y el descendiente sobrevivia para siempre.
//
// POSIX unicamente: en Windows `killTree` ya usa `taskkill /F` desde la
// primera accion (no hay una fase de gracia real que observar), y no hay
// grupos de procesos POSIX que forzar.
if (process.platform !== "win32") {
  const dir = fs.mkdtempSync(path.join(tempRoot, "arbol-"));
  const pidFile = path.join(dir, "nieto.pid");
  const script = path.join(dir, "padre.mjs");
  // `spawnCapture` no reenvia `env` al hijo, asi que la ruta del pidfile se
  // incrusta LITERAL en el codigo del nieto. Dos capas de `JSON.stringify`
  // porque el codigo del nieto (que a su vez contiene la ruta como literal) se
  // vuelve a incrustar, literal, en el script del lider: asi ninguna capa
  // depende de escapar backslashes de Windows a mano.
  const codigoNieto = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  fs.writeFileSync(
    script,
    [
      "import { spawn } from 'node:child_process';",
      "import fs from 'node:fs';",
      // El nieto ignora SIGTERM y deja constancia de su PID.
      `const codigoNieto = ${JSON.stringify(codigoNieto)};`,
      "spawn(process.execPath, ['-e', codigoNieto], { stdio: 'ignore' });",
      // El lider NO desborda hasta que el nieto esta LISTO. Desbordar de
      // inmediato -- como hacia la primera version de esta prueba -- mandaba
      // el SIGTERM del grupo mientras el nieto todavia arrancaba Node y AUN NO
      // habia registrado su handler: moria por el SIGTERM por defecto y el
      // escenario no se montaba. En Windows la prueba se salta, asi que el
      // defecto solo se vio al ejercitarla de verdad en POSIX.
      `const PIDFILE = ${JSON.stringify(pidFile)};`,
      "const listo = setInterval(() => {",
      "  if (!fs.existsSync(PIDFILE)) return;",
      "  clearInterval(listo);",
      // Ahora si: el SIGTERM del grupo llega al lider (sin handler propio:
      // muere) y al nieto (con handler propio: lo ignora).
      "  process.stdout.write('x'.repeat(2 * 1024 * 1024));",
      "}, 10);"
    ].join("\n"),
    "utf8"
  );

  await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024, killGraceMs: 300 }).catch(() => null);

  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(fs.existsSync(pidFile), "el nieto llego a escribir su pid: el escenario se monto de verdad");
  const nietoPid = Number(fs.readFileSync(pidFile, "utf8"));

  // Se da tiempo a que venza killGraceMs y a que la escalada, si dispara, mate
  // al nieto.
  await new Promise((resolve) => setTimeout(resolve, 700));

  let vivo = true;
  try {
    process.kill(nietoPid, 0);
  } catch {
    vivo = false;
  }
  if (vivo) {
    try {
      process.kill(nietoPid, "SIGKILL");
    } catch {
      /* limpieza best-effort */
    }
  }
  assert.equal(vivo, false, "el nieto tiene que estar muerto: la escalada fuerza el GRUPO aunque el lider ya saliera");
}

console.log(
  process.platform === "win32"
    ? "watchdog fuerza el grupo tras salir el lider: SKIP (Windows no tiene grupos POSIX que ejercitar)"
    : "watchdog fuerza el grupo tras salir el lider: PASS"
);

// --- 14. createCaptureBudget rechaza totales invalidos ---------------------
// MENOR de la ronda 5. Con `-1`, `available` arrancaba negativo y ningun
// `need` (siempre >= 0) podia satisfacer `available >= need`; con `NaN`, toda
// comparacion es falsa. En los dos casos quien esperara en la cola no se
// drenaba NUNCA -- un worker del pool de la auditoria colgado sin veredicto.
{
  for (const malo of [-1, Number.NaN, Number.NEGATIVE_INFINITY]) {
    assert.throws(() => createCaptureBudget(malo), /totalBytes/, `${malo} tiene que rechazarse al crear el presupuesto`);
  }
  // Y que de verdad rechaza ANTES de dejar nada a medio construir: cero es
  // valido (cola vacia desde el principio, nunca se drena porque nunca hay
  // nada que drenar, no porque este roto).
  const vacio = createCaptureBudget(0);
  assert.equal(vacio.total, 0);
}

console.log("createCaptureBudget rechaza totales invalidos: PASS");

// --- 15. el presupuesto reservado es EXACTO, no redondeado a bloques -------
// SERIO de la ronda 5. `ensureBudget` redondeaba cada crecimiento al bloque de
// `INITIAL_RESERVE_BYTES` (8 MiB): dos capturas concurrentes que solo
// necesitaban ~2 MiB mas alla de su reserva inicial reclamaban 8 MiB cada una
// igual, y la segunda en pedir se quedaba sin presupuesto compartido aunque la
// suma de lo REALMENTE necesitado cupiera de sobra. No se puede observar el
// redondeo espiando `availableBytes()` desde fuera (la reserva inicial de
// `acquire` ya usa ese mismo tamaño de bloque, y confundiria las dos cosas):
// se prueba por el desenlace, con dos capturas cuyo defecto real (~10 MiB cada
// una, 2 MiB por encima del bloque de 8) solo cabe junto si el crecimiento
// posterior es exacto.
{
  const dir = fs.mkdtempSync(path.join(tempRoot, "goteo-"));
  const script = path.join(dir, "goteo.mjs");
  // ~10 MiB por proceso, en chunks de 300 KiB, paceado -- streaming real, no
  // un solo `write` que ya haya terminado antes de que la otra capture llegue
  // a competir por el presupuesto compartido.
  fs.writeFileSync(
    script,
    [
      "const b = Buffer.alloc(300 * 1024, 0x61);",
      "let i = 0;",
      "const t = setInterval(() => { if (i++ >= 34) { clearInterval(t); return; } process.stdout.write(b); }, 6);"
    ].join("\n"),
    "utf8"
  );

  // Aritmetica exacta (la ronda 6 corrigio la primera version de este
  // comentario, que redondeaba y no cuadraba):
  //   - cada captura escribe 34 x 307 200 = 10 444 800 B;
  //   - reserva inicial 8 388 608 B (8 MiB), asi que crece 2 056 192 B;
  //   - las dos juntas necesitan crecer 4 112 384 B;
  //   - presupuesto 25 165 824 B (24 MiB) - 16 777 216 B de reservas
  //     iniciales = 8 388 608 B de holgura.
  // Con crecimiento exacto sobran 4 276 224 B y las dos caben. Con el redondeo
  // viejo, la PRIMERA en crecer pide un bloque de 8 388 608 B y se lleva la
  // holgura entera; a la segunda no le queda nada y corta por "presupuesto".
  for (let intento = 1; intento <= 3; intento += 1) {
    const budget = createCaptureBudget(24 * 1024 * 1024);
    const resultados = await Promise.all(
      Array.from({ length: 2 }, () => spawnCapture(process.execPath, [script], { maxBuffer: 16 * 1024 * 1024, killGraceMs: 500, budget }))
    );
    assert.deepEqual(
      resultados.map((r) => r.ok),
      [true, true],
      `intento ${intento}: las dos tienen que caber -- si alguna corto, el crecimiento volvio a redondear a bloques`
    );
    assert.equal(budget.availableBytes(), budget.total, `intento ${intento}: el presupuesto vuelve completo`);
  }
}

console.log("presupuesto exacto, sin redondeo a bloques: PASS");

// --- 16. taskkill sin PATH no tumba el proceso Node -------------------------
// SERIO de la ronda 5, Windows unicamente (la rama POSIX de `killTree` no usa
// `taskkill`). Un `spawn` de `taskkill` que falla con ENOENT emite su `error`
// de forma ASINCRONA: el `try/catch` alrededor del `spawn` no lo ve, y sin un
// listener de `error` propio ese evento sin manejar tumba el proceso Node
// ENTERO -- reproducido antes de este fix con un binario inexistente.
if (process.platform === "win32") {
  const PATH_ORIGINAL = process.env.PATH ?? process.env.Path;
  const dir = fs.mkdtempSync(path.join(tempRoot, "sin-taskkill-"));
  try {
    // PATH vacio: ni System32 (donde vive taskkill.exe) queda visible.
    process.env.PATH = dir;
    process.env.Path = dir;

    const script = path.join(tempRoot, "corto.mjs");
    fs.writeFileSync(script, "process.stdout.write('x'.repeat(2 * 1024 * 1024));", "utf8");

    // Si el listener de `error` faltara, este `await` ni siquiera llegaria a
    // resolver: el proceso de prueba entero moriria por el evento sin atrapar
    // antes de que el test pudiera afirmar nada.
    const resultado = await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024, killGraceMs: 300 });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.overflow, true);
  } finally {
    if (PATH_ORIGINAL === undefined) {
      delete process.env.PATH;
      delete process.env.Path;
    } else {
      process.env.PATH = PATH_ORIGINAL;
      process.env.Path = PATH_ORIGINAL;
    }
  }
}

console.log(
  process.platform === "win32"
    ? "taskkill sin PATH no tumba el proceso: PASS"
    : "taskkill sin PATH no tumba el proceso: SKIP (POSIX no depende de taskkill)"
);

// --- 17. limpieza de hijos detached (Ctrl-C) alcanza al GRUPO --------------
// SERIO de la ronda 5. `detached: true` pone al hijo en su PROPIO grupo:
// Ctrl-C en la terminal señala al grupo ORIGINAL de Node, no a este. Sin un
// registro y limpieza explicita, un `git`/GPG de verificacion interrumpido a
// mitad de auditoria puede quedar huerfano y vivo. Se prueba la funcion de
// limpieza DIRECTAMENTE, no mandando la señal de verdad: eso terminaria al
// propio proceso de la prueba antes de poder afirmar nada.
//
// POSIX unicamente: en Windows `captureProcess` no detacha (no hay grupos
// POSIX que registrar ni limpiar).
if (process.platform !== "win32") {
  const { killAllActiveChildren } = await import("../src/file-utils.js");

  const dir = fs.mkdtempSync(path.join(tempRoot, "ctrlc-"));
  const pidFile = path.join(dir, "nieto.pid");
  const script = path.join(dir, "padre.mjs");
  const codigoNieto = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  fs.writeFileSync(
    script,
    [
      "import { spawn } from 'node:child_process';",
      `const codigoNieto = ${JSON.stringify(codigoNieto)};`,
      "spawn(process.execPath, ['-e', codigoNieto], { stdio: 'ignore' });",
      // El lider NO desborda ni sale por su cuenta: sigue vivo, para que la
      // captura siga "en vuelo" cuando se dispare la limpieza.
      "setInterval(() => {}, 1000);"
    ].join("\n"),
    "utf8"
  );

  const captura = spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024, killGraceMs: 2000 });

  for (let i = 0; i < 50 && !fs.existsSync(pidFile); i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.ok(fs.existsSync(pidFile), "el nieto llego a escribir su pid: el escenario se monto de verdad");
  const nietoPid = Number(fs.readFileSync(pidFile, "utf8"));

  // Todavia en vuelo: ni desbordo ni el lider salio por su cuenta. Es el
  // momento en que Ctrl-C, de verdad, tendria que alcanzar a este arbol.
  killAllActiveChildren();

  const resultado = await captura;
  assert.equal(resultado.ok, false, "el lider murio por la limpieza forzada, no por salir limpio");

  await new Promise((resolve) => setTimeout(resolve, 300));
  let vivo = true;
  try {
    process.kill(nietoPid, 0);
  } catch {
    vivo = false;
  }
  if (vivo) {
    try {
      process.kill(nietoPid, "SIGKILL");
    } catch {
      /* limpieza best-effort */
    }
  }
  assert.equal(vivo, false, "el nieto tiene que estar muerto: la limpieza alcanza al GRUPO detached, no solo al lider");
}

console.log(
  process.platform === "win32"
    ? "limpieza de hijos detached: SKIP (Windows no detacha, no hay grupos POSIX que limpiar)"
    : "limpieza de hijos detached: PASS"
);

// --- 18. la ventana entre el corte y la muerte real sigue cubierta ---------
// BLOQUEANTE de la ronda 6, encontrado por las dos voces por separado. `trip()`
// resuelve la promesa DE INMEDIATO y deja al hijo vivo durante toda la ventana
// de `killGraceMs` -- justo el caso en que ya consta que resistio el SIGTERM.
// La primera version daba de baja al hijo del registro de limpieza dentro de
// `settle()`, o sea al resolver: un Ctrl-C en esa ventana no lo encontraba,
// `process.exit()` mataba Node, el temporizador (unref) no llegaba a correr y
// el grupo quedaba huerfano. El test 17 no lo cubre porque ahi la captura
// NUNCA corta.
//
// POSIX unicamente: en Windows no se detacha y no hay registro que consultar.
if (process.platform !== "win32") {
  const { killAllActiveChildren } = await import("../src/file-utils.js");

  const dir = fs.mkdtempSync(path.join(tempRoot, "ventana-"));
  const pidFile = path.join(dir, "nieto.pid");
  const script = path.join(dir, "padre.mjs");
  const codigoNieto = `process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  fs.writeFileSync(
    script,
    [
      "import { spawn } from 'node:child_process';",
      "import fs from 'node:fs';",
      `const codigoNieto = ${JSON.stringify(codigoNieto)};`,
      "spawn(process.execPath, ['-e', codigoNieto], { stdio: 'ignore' });",
      `const PIDFILE = ${JSON.stringify(pidFile)};`,
      "const listo = setInterval(() => {",
      "  if (!fs.existsSync(PIDFILE)) return;",
      "  clearInterval(listo);",
      "  process.stdout.write('x'.repeat(2 * 1024 * 1024));",
      "}, 10);"
    ].join("\n"),
    "utf8"
  );

  // `killGraceMs` largo A PROPOSITO: deja la ventana abierta de sobra para
  // actuar dentro de ella. Si la limpieza dependiera del temporizador y no del
  // registro, este test no podria distinguir una cosa de la otra.
  const resultado = await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024, killGraceMs: 30_000 });
  assert.equal(resultado.overflow, true, "la captura corto, que es lo que abre la ventana");

  assert.ok(fs.existsSync(pidFile), "el nieto llego a escribir su pid antes del corte");
  const nietoPid = Number(fs.readFileSync(pidFile, "utf8"));

  const vive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  assert.ok(vive(nietoPid), "el nieto sigue vivo tras el corte: ignoro el SIGTERM, que es el escenario");

  // Esto es lo que haria el handler de Ctrl-C. Con la version vieja el hijo ya
  // no estaba en el registro y esta llamada no hacia NADA.
  killAllActiveChildren();
  await new Promise((resolve) => setTimeout(resolve, 300));

  const sigueVivo = vive(nietoPid);
  if (sigueVivo) {
    try {
      process.kill(nietoPid, "SIGKILL");
    } catch {
      /* limpieza best-effort */
    }
  }
  assert.equal(
    sigueVivo,
    false,
    "el nieto tiene que morir: el hijo sigue en el registro durante toda la ventana entre el corte y su muerte real"
  );
}

console.log(
  process.platform === "win32"
    ? "ventana entre corte y muerte real: SKIP (Windows no detacha)"
    : "ventana entre corte y muerte real: PASS"
);
