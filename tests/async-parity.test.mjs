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
import { spawnCapture } from "../src/file-utils.js";
import { computeTreeHashAtRef, computeTreeHashAtRefAsync } from "../src/evidence-writer.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-parity-"));

// --- 1. UTF-8 partido entre chunks -----------------------------------------
// El caso NO es decorativo y costo construirlo: con acentos de 2 bytes los
// cortes del pipe caen en frontera de caracter por casualidad y el bug no
// aparece. Con '€' —3 bytes— y un chunk de 64 KiB, 65536 no es multiplo de 3 y
// el corte cae DENTRO del caracter. Medido contra la implementacion vieja
// (`stdout += chunk`): 10 caracteres de reemplazo; con acumulacion de buffers,
// cero. Sin este detalle el test pasaria igual con el codigo roto.
{
  const script = path.join(tempRoot, "emit.mjs");
  fs.writeFileSync(script, "process.stdout.write('€'.repeat(120000));", "utf8");

  const sync = spawnSync(process.execPath, [script], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const async_ = await spawnCapture(process.execPath, [script], { maxBuffer: 64 * 1024 * 1024 });

  assert.equal(async_.ok, true);
  assert.equal(async_.stdout, sync.stdout, "async y sync tienen que producir EXACTAMENTE el mismo texto");
  assert.equal(async_.stdout.length, 120000, "ni un caracter de mas ni de menos");
  assert.ok(!async_.stdout.includes("�"), "ningun caracter de reemplazo: el UTF-8 no puede partirse");
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
