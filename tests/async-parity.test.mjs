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
import {
  CAPTURE_CEILING_BYTES,
  MAX_CONCURRENT_CAPTURES,
  MAX_KILL_GRACE_MS,
  TREE_HASH_MAX_BUFFER,
  captureQueueDepth,
  captureReservedBytes,
  decodeCapture,
  spawnCapture
} from "../src/file-utils.js";
import { computeTreeHashAtRef, computeTreeHashAtRefAsync } from "../src/evidence-writer.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-parity-"));

// Un cuelgue NO puede ser un build verde. Esta suite usa `await` de nivel
// superior, y cuando una promesa no resuelve Node se limita a avisar
// ("Detected unsettled top-level await") y sale con codigo CERO: el pipeline lo
// lee como exito. Se descubrio mutando la liberacion del presupuesto -- la
// suite se colgaba en el caso 7 y aun asi "pasaba".
//
// El temporizador NO va `unref`-ado: tiene que mantener vivo el bucle
// precisamente cuando ya no queda nada mas, que es el escenario del cuelgue.
const CUELGUE_MS = Number(process.env.SDLC_TEST_HANG_TIMEOUT_MS ?? 10 * 60 * 1000);
const vigilanteGlobal = setTimeout(() => {
  console.error(`\nLA SUITE SE COLGO: mas de ${CUELGUE_MS / 1000} s sin terminar.`);
  console.error("Un `await` de nivel superior no resolvio. Node saldria con 0 y el pipeline lo leeria como exito.");
  process.exit(1);
}, CUELGUE_MS);

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
// LOS DOS ORDENES, y no por simetria decorativa: el handler que cruza el
// umbral es el del stream que escribe SEGUNDO. Con un solo orden, revertir a
// "por stream" el otro handler pasaba la prueba sin que nadie se enterara --
// comprobado por mutacion, sobrevivio.
{
  const maxBuffer = 10 * 1024 * 1024;
  // Ninguno de los dos streams supera el tope por si solo (6 < 10); juntos, si.
  const casos = [
    { nombre: "stdout primero (cruza el umbral el handler de stderr)", primero: "stdout", segundo: "stderr" },
    { nombre: "stderr primero (cruza el umbral el handler de stdout)", primero: "stderr", segundo: "stdout" }
  ];

  for (const caso of casos) {
    const script = path.join(tempRoot, `dos-streams-${caso.primero}.mjs`);
    // Las dos escrituras van SEPARADAS EN EL TIEMPO. Emitidas seguidas, los dos
    // pipes entregan intercalado y el umbral acaba cruzandose siempre en el
    // handler del stream que mas chunks mueve -- daba igual el orden, y el
    // mutante que revertia el OTRO handler sobrevivia. Con la pausa, el primer
    // stream esta enteramente consumido antes de que el segundo empiece, asi
    // que quien cruza el umbral es exactamente el handler del segundo.
    fs.writeFileSync(
      script,
      [
        `process.${caso.primero}.write('a'.repeat(6 * 1024 * 1024));`,
        `setTimeout(() => process.${caso.segundo}.write('b'.repeat(6 * 1024 * 1024)), 400);`
      ].join("\n"),
      "utf8"
    );

    const sync = spawnSync(process.execPath, [script], { maxBuffer, encoding: "buffer" });
    const async_ = await spawnCapture(process.execPath, [script], { maxBuffer });

    assert.ok(sync.error, `${caso.nombre}: spawnSync corta con ENOBUFS -- gasta UN presupuesto entre los dos streams`);
    assert.equal(sync.error.code, "ENOBUFS", caso.nombre);
    assert.equal(
      async_.ok,
      false,
      `${caso.nombre}: la via async tiene que cortar TAMBIEN -- si limita cada stream por separado, acepta lo que la sincrona rechaza`
    );
    assert.equal(async_.overflow, true, caso.nombre);
    assert.equal(async_.reason, "maxBuffer", caso.nombre);
  }
}

console.log("maxBuffer combinado entre stdout y stderr: PASS");

// --- 5c. el corte es EXACTO, sin margen -------------------------------------
// MENOR de la ronda 8, mutante superviviente: dar 1 KiB de margen al corte
// (`outSize + errSize > maxBuffer + 1024`) dejaba la suite entera en verde.
// El caso 5b usa margenes grandes (6 MiB de cada lado, tope de 10 MiB) porque
// prueba OTRA cosa -- que el presupuesto es compartido, no por stream -- y ese
// margen amplio es precisamente lo que dejaba pasar 1 KiB de mas sin que nadie
// lo notara. Este caso prueba la frontera misma: en el limite exacto no
// desborda; un byte mas si, y en LAS DOS vias.
{
  const maxBuffer = 100 * 1024; // 100 KiB
  const escribir = (bytes) => `process.stdout.write('a'.repeat(${bytes}));`;

  const script1 = path.join(tempRoot, "borde-exacto.mjs");
  fs.writeFileSync(script1, escribir(maxBuffer), "utf8");
  const sync1 = spawnSync(process.execPath, [script1], { maxBuffer, encoding: "utf8" });
  const async1 = await spawnCapture(process.execPath, [script1], { maxBuffer });
  assert.equal(sync1.status, 0, "exactamente maxBuffer bytes NO desborda en spawnSync");
  assert.equal(async1.ok, true, "exactamente maxBuffer bytes NO desborda en spawnCapture -- sin margen de mas");

  const script2 = path.join(tempRoot, "borde-mas-uno.mjs");
  fs.writeFileSync(script2, escribir(maxBuffer + 1), "utf8");
  const sync2 = spawnSync(process.execPath, [script2], { maxBuffer, encoding: "utf8" });
  const async2 = await spawnCapture(process.execPath, [script2], { maxBuffer });
  assert.notEqual(sync2.status, 0, "maxBuffer + 1 byte SI desborda en spawnSync");
  assert.equal(async2.ok, false, "maxBuffer + 1 byte SI desborda en spawnCapture -- ni un KiB de margen");
  assert.equal(async2.overflow, true);
}

console.log("corte exacto, sin margen: PASS");

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

// --- 11. topes invalidos se rechazan ANTES de arrancar el hijo -------------
{
  for (const malo of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    await assert.rejects(
      () => spawnCapture(process.execPath, ["-e", "0"], { maxBuffer: malo }),
      /maxBuffer/,
      `maxBuffer ${malo} tiene que rechazarse`
    );
  }
  // `0` es valido y NO es un rechazo: significa "cualquier salida desborda".
  const cero = await spawnCapture(process.execPath, ["-e", "process.stdout.write('x')"], { maxBuffer: 0, killGraceMs: 200 });
  assert.equal(cero.overflow, true, "con maxBuffer 0 cualquier byte desborda, pero no es un error de argumento");

  // La gracia esta ACOTADA ARRIBA a proposito: el SIGKILL de la escalada va al
  // grupo por pgid, y ese pgid solo sigue siendo el nuestro mientras la ventana
  // sea corta. Sin tope, el argumento de riesgo escrito en `trip` deja de
  // sostenerse sin que nadie lo note (lo señalo la ronda 7).
  //
  // El tope se afirma LITERAL, no solo `+1` sobre lo que sea que declare el
  // codigo. Ronda 8: `MAX_KILL_GRACE_MS + 1` importado del propio codigo dejaba
  // pasar un mutante que subia el tope de 30 s a 60 s -- el test seguia
  // "rechazando el siguiente valor" sin importar cual fuera ese valor. El
  // numero en si es la politica; hay que afirmarlo, no solo su frontera.
  assert.equal(MAX_KILL_GRACE_MS, 5_000, "el tope de la gracia es una decision de riesgo, no un detalle: si cambia, tiene que ser a proposito");

  for (const malo of [Number.NaN, Number.POSITIVE_INFINITY, -1, MAX_KILL_GRACE_MS + 1]) {
    await assert.rejects(
      () => spawnCapture(process.execPath, ["-e", "0"], { killGraceMs: malo }),
      /killGraceMs/,
      `killGraceMs ${malo} tiene que rechazarse`
    );
  }
}

console.log("validacion de maxBuffer y killGraceMs: PASS");

// --- 12. el veredicto no depende de cuantas capturas haya en vuelo ---------
// Historia de tres rondas, y por eso este caso existe. Hubo un presupuesto de
// memoria GLOBAL compartido entre capturas: la misma entrada podia salir `ok`
// o cortada segun quien ganara la carrera por ese estado compartido (ronda 5),
// y el intento de arreglarlo bajando solo una via convirtio la carrera en una
// divergencia fija (ronda 6). El presupuesto se quito: el unico tope es el de
// cada llamada, que es una propiedad LOCAL y no puede depender de las vecinas.
{
  // El tope por llamada se deriva del techo de diseño y de la concurrencia
  // esperada. Ese "4" vive duplicado en file-utils.js porque importar
  // AUDIT_CONCURRENCY desde ahi cerraria un ciclo con evidence-writer.js. Esta
  // asercion es lo unico que impide que los dos numeros diverjan en silencio.
  assert.equal(
    TREE_HASH_MAX_BUFFER * HARNESS_AUDIT_CONCURRENCY,
    CAPTURE_CEILING_BYTES,
    "el tope por llamada por AUDIT_CONCURRENCY tiene que dar exactamente el techo de diseño"
  );

  // Y LAS DOS vias del hash de arbol tienen que declarar el MISMO tope: es lo
  // que hace que acepten y rechacen las mismas entradas. Se comprueba sobre
  // las declaraciones porque el desacuerdo vive ahi, y montar un arbol real de
  // 64 MiB costaria minutos por corrida.
  const fuente = fs.readFileSync(new URL("../src/evidence-writer.js", import.meta.url), "utf8");
  const topes = [...fuente.matchAll(/maxBuffer:\s*([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  assert.ok(topes.length >= 2, `se esperaban las dos vias del hash de arbol declarando tope, y se vieron ${topes.length}`);
  assert.deepEqual(
    [...new Set(topes)],
    ["TREE_HASH_MAX_BUFFER"],
    `las dos vias tienen que declarar EL MISMO tope y ser TREE_HASH_MAX_BUFFER; se vio ${JSON.stringify(topes)}`
  );

  const dir = fs.mkdtempSync(path.join(tempRoot, "carga-"));
  const script = path.join(dir, "lento.mjs");
  // Escritura PACEADA: streaming real, para que las capturas esten vivas a la
  // vez. Con el presupuesto compartido, ese solape era justo lo que hacia
  // variar el resultado entre corridas.
  fs.writeFileSync(
    script,
    [
      "const b = Buffer.alloc(1024 * 1024, 0x61);",
      "let i = 0;",
      "const t = setInterval(() => { if (i++ >= 12) { clearInterval(t); return; } process.stdout.write(b); }, 4);"
    ].join("\n"),
    "utf8"
  );

  // La MISMA entrada, primero sola y luego con cuatro en vuelo. El tope se
  // elige por encima de lo que escribe el hijo (12 MiB), asi que la respuesta
  // correcta es `ok` en los dos casos: si la concurrencia cambiara el
  // desenlace, es que volvio a haber estado compartido.
  const maxBuffer = 16 * 1024 * 1024;
  const sola = await spawnCapture(process.execPath, [script], { maxBuffer, killGraceMs: 500 });
  assert.equal(sola.ok, true, "una sola captura de 12 MiB cabe en un tope de 16 MiB");

  for (let intento = 1; intento <= 3; intento += 1) {
    const enParalelo = await Promise.all(
      Array.from({ length: 4 }, () => spawnCapture(process.execPath, [script], { maxBuffer, killGraceMs: 500 }))
    );
    assert.deepEqual(
      enParalelo.map((r) => r.ok),
      [true, true, true, true],
      `intento ${intento}: las cuatro tienen que salir igual que la que corrio sola -- el veredicto no puede depender de las vecinas`
    );
  }
}

console.log("el veredicto no depende de la concurrencia: PASS");

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

  // `killGraceMs` largo A PROPOSITO (pero dentro de MAX_KILL_GRACE_MS, que
  // bajo a 5 s en la ronda 8): deja la ventana abierta de sobra para actuar
  // dentro de ella. Si la limpieza dependiera del temporizador y no del
  // registro, este test no podria distinguir una cosa de la otra.
  const resultado = await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024, killGraceMs: 3_000 });
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

// --- 19. spawnCapture no deja pasar mas de MAX_CONCURRENT_CAPTURES a la vez -
// SERIO de la ronda 8. `spawnCapture` es publica y, tras quitar el presupuesto
// global en la ronda 7, se quedo SIN memoria de sus vecinas: nada impedia que
// un consumidor (o dos auditorias solapadas) la llamara mas veces de las que
// `CAPTURE_CEILING_BYTES` asume. Medido por Codex antes de este fix: cinco
// capturas de 63 MiB en paralelo retuvieron 315 MiB con un pico de 497 MiB de
// RSS. Aqui se prueba el MECANISMO -- que la admision se pone en cola pasado
// el cupo -- sin gastar esa memoria: el hijo es liviano, lo que se mide es
// cuantos estan vivos a la vez.
// El presupuesto es POR BYTES DECLARADOS, no por numero de capturas -- contar
// capturas no bastaba, porque el tope por captura es configurable y cuatro
// cupos de 128 MiB daban 512 MiB (ronda 9). Como la reserva va sobre el tope
// DECLARADO, esta prueba puede pedir 64 MiB por captura sin gastar ni uno: los
// hijos no escriben casi nada. Lo que se mide es la contabilidad, no la RAM.
//
// Las aserciones son EXACTAS a proposito. Ronda 9 mostro que las cotas flojas
// (`0 < profundidad <= 3`) dejaban pasar dos mutantes: cambiar `<` por `<=` en
// la admision, y una liberacion que pierde la cuenta. Con igualdades y una
// SEGUNDA tanda, los dos mueren.
{
  const script = path.join(tempRoot, "lento-de-admitir.mjs");
  fs.writeFileSync(script, "setTimeout(() => process.stdout.write('ok'), 300);", "utf8");

  const porCaptura = Math.floor(CAPTURE_CEILING_BYTES / MAX_CONCURRENT_CAPTURES);
  const extra = 3;
  const total = MAX_CONCURRENT_CAPTURES + extra;

  assert.equal(captureQueueDepth(), 0, "la cola tiene que arrancar vacia");
  assert.equal(captureReservedBytes(), 0, "el presupuesto tiene que arrancar sin reservar");

  const lanzarTanda = () =>
    Array.from({ length: total }, () =>
      spawnCapture(process.execPath, [script], { maxBuffer: porCaptura, killGraceMs: 500 })
    );

  for (const tanda of ["primera", "segunda"]) {
    const promesas = lanzarTanda();

    // La admision es sincrona hasta el primer `await`, asi que en cuanto se
    // ceda el turno ya estan repartidos los cupos: no depende de temporizacion.
    await new Promise((resolve) => setTimeout(resolve, 60));

    assert.equal(
      captureQueueDepth(),
      extra,
      `${tanda} tanda: tienen que esperar EXACTAMENTE las ${extra} que exceden el techo`
    );
    assert.equal(
      captureReservedBytes(),
      MAX_CONCURRENT_CAPTURES * porCaptura,
      `${tanda} tanda: lo reservado tiene que ser exactamente el techo, ni un byte mas`
    );
    assert.ok(
      captureReservedBytes() <= CAPTURE_CEILING_BYTES,
      `${tanda} tanda: lo reservado no puede superar el techo`
    );

    // Con tope: si la liberacion no descuenta, la cola no drena NUNCA y esto se
    // colgaria en vez de fallar. Un cuelgue tambien "detecta" el mutante, pero
    // en CI es un timeout sin diagnostico; asi se convierte en un mensaje.
    // El temporizador NO va `unref`-ado a proposito: si las capturas encoladas
    // nunca se admiten, no queda nada vivo en el bucle y Node saldria EN
    // SILENCIO con codigo 0 -- la suite "pasaria" sin haber probado nada.
    // Mantenerlo referenciado es lo que garantiza que el fallo se vea.
    let vigilante;
    const resultados = await Promise.race([
      Promise.all(promesas).finally(() => clearTimeout(vigilante)),
      new Promise((_, reject) => {
        vigilante = setTimeout(
          () =>
            reject(
              new Error(
                `${tanda} tanda: la cola no drenó en 20 s -- lo reservado quedó en ${captureReservedBytes()} y ${captureQueueDepth()} esperando. Sintoma tipico de una liberacion que no descuenta.`
              )
            ),
          20_000
        );
      })
    ]);
    assert.ok(resultados.every((r) => r.ok), `${tanda} tanda: la cola retrasa, no descarta`);
    assert.equal(captureQueueDepth(), 0, `${tanda} tanda: la cola vuelve a vaciarse`);
    // Si la liberacion pierde la cuenta, esto queda distinto de cero y la
    // SEGUNDA tanda ya no encolaria nada -- que es justo el mutante que
    // sobrevivia antes.
    assert.equal(captureReservedBytes(), 0, `${tanda} tanda: el presupuesto vuelve INTACTO a cero`);
  }
}

console.log("presupuesto de admision por bytes declarados: PASS");

// --- 20. un tope mayor que el techo se rechaza, no se cuelga ---------------
// Si una sola captura pidiera mas que el techo entero, su admision no podria
// satisfacerse NUNCA y quien la pidiera se quedaria esperando para siempre.
{
  await assert.rejects(
    () => spawnCapture(process.execPath, ["-e", "0"], { maxBuffer: CAPTURE_CEILING_BYTES + 1 }),
    /no puede superar el techo/,
    "un maxBuffer mayor que el techo tiene que rechazarse en el acto"
  );
  assert.equal(captureReservedBytes(), 0, "un rechazo no puede dejar bytes reservados");
  assert.equal(captureQueueDepth(), 0, "un rechazo no puede dejar a nadie en cola");
}

console.log("tope mayor que el techo rechazado: PASS");

clearTimeout(vigilanteGlobal);
