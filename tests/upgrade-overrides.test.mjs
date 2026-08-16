// ---------------------------------------------------------------------------
// 2.0.3: un archivo registrado como override en `.sdlc/overrides.yaml` (via
// `sdlc upgrade --accept-managed <path>`) dejaba de estar protegido en el
// SIGUIENTE `sdlc upgrade`, incluso si esa corrida no tocaba ese archivo.
// `detectConflicts` comparaba el disco contra la plantilla fresca, y si el
// disco coincidia con el sha del manifiesto (que tras aceptar un override ES
// el sha del override) lo daba por "sin conflicto" -- sin conflicto
// significaba "no hace falta re-aceptarlo", y el path quedaba fuera de
// `skipWrite`: `writeManagedFiles` lo pisaba con la plantilla nueva sin
// avisar. Encontrado en adopcion real en un consumidor (13 personas
// `.agent.md` + identity docs clobbereados), no leyendo el codigo primero.
//
// Segundo bug relacionado: un archivo gestionado borrado a proposito
// reaparecia solo con volver a correr `upgrade`, porque `detectConflicts`
// se saltaba por completo cualquier path ausente en disco.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { run } from "../src/cli.js";

function mkTarget(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "consumer", version: "1.0.0" }, null, 2), "utf8");
  return dir;
}

async function install(dir) {
  const result = await run(["install", "--target", dir, "--project-name", "consumer", "--json"]);
  assert.equal(result.exitCode, 0, JSON.stringify(result.payload));
  return result;
}

function firstManagedPath(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".sdlc", "install-manifest.json"), "utf8"));
  assert.ok(manifest.managedFiles.length > 0, "el install de fixture debe dejar al menos un archivo gestionado");
  return manifest.managedFiles[0].path;
}

// --- (a) override aceptado sobrevive a un upgrade NO relacionado ----------
{
  const dir = mkTarget("sdlc-upgrade-override-survives-");
  await install(dir);

  const targetPath = firstManagedPath(dir);
  const absolute = path.join(dir, targetPath);
  const original = fs.readFileSync(absolute, "utf8");
  const customized = `${original}\n# customizacion local del consumidor\n`;
  fs.writeFileSync(absolute, customized, "utf8");

  // Se acepta explicitamente una vez, como haria un consumidor real.
  const accept = await run(["upgrade", "--target", dir, "--accept-managed", targetPath, "--json"]);
  assert.equal(accept.exitCode, 0, JSON.stringify(accept.payload));
  assert.deepEqual(accept.payload.accepted, [targetPath]);
  assert.equal(fs.readFileSync(absolute, "utf8"), customized, "el override debe sobrevivir a la corrida que lo acepta");

  const overrides = YAML.parse(fs.readFileSync(path.join(dir, ".sdlc", "overrides.yaml"), "utf8"));
  assert.ok(
    overrides.overrides.some((entry) => entry.path === targetPath),
    "overrides.yaml debe registrar el path aceptado"
  );

  // Una corrida SIN --accept-managed para ese path (la reproduccion real:
  // "por cualquier motivo no relacionado, por ejemplo aceptar OTRO archivo o
  // simplemente re-correr upgrade") no debe pisar el override.
  const unrelated = await run(["upgrade", "--target", dir, "--json"]);
  assert.equal(unrelated.exitCode, 0, JSON.stringify(unrelated.payload));
  assert.equal(
    fs.readFileSync(absolute, "utf8"),
    customized,
    "BUG 2.0.2: un upgrade no relacionado pisaba en silencio un override ya aceptado"
  );

  // Y sobrevive a mas de una corrida no relacionada seguida.
  const unrelatedAgain = await run(["upgrade", "--target", dir, "--json"]);
  assert.equal(unrelatedAgain.exitCode, 0, JSON.stringify(unrelatedAgain.payload));
  assert.equal(fs.readFileSync(absolute, "utf8"), customized, "el override debe sobrevivir a corridas repetidas");

  console.log("upgrade: override aceptado sobrevive a upgrade no relacionado: PASS");
}

// --- (b) archivo gestionado borrado a proposito no reaparece --------------
{
  const dir = mkTarget("sdlc-upgrade-deleted-file-");
  await install(dir);

  const targetPath = firstManagedPath(dir);
  const absolute = path.join(dir, targetPath);
  fs.rmSync(absolute);
  assert.equal(fs.existsSync(absolute), false);

  // Sin decision explicita, upgrade debe BLOQUEAR (accion requerida), no
  // recrear el archivo en silencio ni fallar de forma opaca.
  const noDecision = await run(["upgrade", "--target", dir, "--json"]);
  assert.equal(noDecision.exitCode, 2, JSON.stringify(noDecision.payload));
  assert.equal(noDecision.payload.status, "conflict");
  assert.ok(
    noDecision.payload.conflicts.some((conflict) => conflict.path === targetPath),
    "la eliminacion debe reportarse como conflicto explicito"
  );
  assert.equal(fs.existsSync(absolute), false, "no debe recrearse solo por correr upgrade sin decidir");

  // El consumidor confirma la eliminacion explicitamente.
  const accept = await run(["upgrade", "--target", dir, "--accept-managed", targetPath, "--json"]);
  assert.equal(accept.exitCode, 0, JSON.stringify(accept.payload));
  assert.equal(fs.existsSync(absolute), false, "la eliminacion aceptada debe respetarse en la misma corrida");

  const overrides = YAML.parse(fs.readFileSync(path.join(dir, ".sdlc", "overrides.yaml"), "utf8"));
  const entry = overrides.overrides.find((candidate) => candidate.path === targetPath);
  assert.ok(entry, "la eliminacion aceptada debe quedar registrada en overrides.yaml");
  assert.equal(entry.deleted, true, "el override debe marcar la eliminacion como deliberada, no como divergencia de contenido");

  // BUG relacionado (2.0.2): una corrida de upgrade posterior, sin que nadie
  // vuelva a pedir nada sobre ese path, recreaba el archivo desde la
  // plantilla porque el path ya no estaba "managed" y por lo tanto no
  // generaba conflicto -- y "sin conflicto" se escribia igual.
  const followUp = await run(["upgrade", "--target", dir, "--json"]);
  assert.equal(followUp.exitCode, 0, JSON.stringify(followUp.payload));
  assert.equal(
    fs.existsSync(absolute),
    false,
    "BUG 2.0.2: un upgrade posterior no relacionado recreaba en silencio un archivo borrado a proposito"
  );

  // Y se mantiene borrado en corridas sucesivas, no solo en la inmediata
  // siguiente.
  const followUpAgain = await run(["upgrade", "--target", dir, "--json"]);
  assert.equal(followUpAgain.exitCode, 0, JSON.stringify(followUpAgain.payload));
  assert.equal(fs.existsSync(absolute), false, "la eliminacion debe seguir respetada en corridas sucesivas");

  console.log("upgrade: archivo gestionado eliminado a proposito no reaparece: PASS");
}
