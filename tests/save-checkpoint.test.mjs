// ---------------------------------------------------------------------------
// `sdlc save`: checkpoint enriquecido y vault sin resolver.
//
// Dos defectos encontrados USANDO el comando en un repo recien instalado, no
// leyendo el codigo:
//
//   1. El config que genera `install` trae `vaultPath: "${VAULT_PATH}"` a
//      proposito (validate:no-personal-paths impide una ruta real ahi), pero
//      `expandEnv` devuelve el marcador LITERAL cuando la variable no existe y
//      nadie lo comprobaba. `save` creaba `<repo>/${MEMORY_WORKSPACE}/vault/...`
//      — el usuario cree que su checkpoint esta en el vault y esta en un
//      directorio basura dentro del repo.
//
//   2. El checkpoint solo traia runtime + diffstat + "Continua". Sin el porque
//      ni lo pendiente, no se puede retomar sin la conversacion, que es
//      justamente lo que un checkpoint existe para evitar.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "sdlc.js");

function newRepo(name) {
  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), `sdlc-save-${name}-`)), "consumidor");
  fs.mkdirSync(target, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: target });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: target });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: target });
  fs.writeFileSync(path.join(target, "a.txt"), "uno\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: target });
  execFileSync("git", ["commit", "--quiet", "-m", "base"], { cwd: target });
  execFileSync("node", [cli, "install", "--target", target, "--mode", "legacy", "--project-name", name, "--json"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  return target;
}
function save(target) {
  return JSON.parse(execFileSync("node", [cli, "save", "--target", target, "--event", "manual", "--json"], { cwd: repoRoot, encoding: "utf8" }));
}

// --- 1. un marcador sin resolver NO puede viajar como ruta ------------------
{
  const target = newRepo("placeholder");
  const result = save(target);
  assert.equal(result.status, "ok");

  assert.ok(
    !fs.existsSync(path.join(target, "${MEMORY_WORKSPACE}")) && !fs.existsSync(path.join(target, "${VAULT_PATH}")),
    "un marcador sin expandir no puede convertirse en un directorio real"
  );
  assert.ok(
    !String(result.checkpoint).includes("${"),
    `la ruta del checkpoint no puede llevar un marcador: ${result.checkpoint}`
  );
  assert.ok(String(result.checkpoint).includes(path.join(".sdlc", "vault")), "cae al vault local, que es el fallback declarado");

  // Y la degradacion se DICE: un vault mal configurado en silencio es peor,
  // porque el usuario cree que sus checkpoints estan en su vault.
  const body = fs.readFileSync(result.checkpoint, "utf8");
  assert.match(body, /sin configurar/, "el checkpoint tiene que avisar de que el vault no esta resuelto");
}

console.log("save vault sin resolver: PASS");

// --- 2. el checkpoint pide lo que el CLI no puede saber ---------------------
{
  const target = newRepo("enriquecido");
  const body = fs.readFileSync(save(target).checkpoint, "utf8");

  // Huecos EXPLICITOS: el CLI no tiene modelo y no puede escribir el porque.
  // Omitir la seccion haria que el checkpoint pareciera completo sin serlo.
  // Estructura tomada de los checkpoints enriquecidos ya en uso en los repos
  // consumidores (.github/agent-state/checkpoint-context.md).
  for (const heading of [/## Alcance y gobernanza/, /## Skills y fuentes usadas/, /## Decisiones y trabajo realizado/, /## Verificacion/, /## Pendientes y siguiente accion/]) {
    assert.match(body, heading, `falta la seccion ${heading}`);
  }
  assert.match(body, /QUE NO SE HIZO/, "lo que no se hizo es contexto tan importante como lo que si");
  assert.match(body, /DESCARTO/, "sin lo descartado, quien retome vuelve a proponerlo");
  assert.ok(
    (body.match(/<!-- AGENTE:/g) ?? []).length >= 5,
    "cada seccion narrativa tiene que decir quien la llena y que poner: un heading vacio se rellena con cualquier cosa"
  );
  assert.match(body, /NO necesite la conversacion/, "el criterio de exito del checkpoint tiene que estar escrito en el propio checkpoint");

  // Y lo factual sí lo pone el CLI.
  assert.match(body, /## Estado verificable/);
  assert.match(body, /Archivos sin commitear/);
  assert.match(body, /HEAD `[0-9a-f]{7}/, "el HEAD real, no una descripcion vaga");
}

console.log("save checkpoint enriquecido: PASS");

// --- 3. los commits desde el checkpoint anterior se llenan de verdad --------
// Aqui vivia el defecto mas silencioso: el nombre del checkpoint es UTC
// (`toISOString`) y `git log --since` sin zona lee hora LOCAL. En UTC-5 el
// `since` apuntaba cinco horas al futuro y la seccion salia vacia SIEMPRE.
// Una seccion decorativa es peor que ninguna: parece que no hubo trabajo.
{
  const target = newRepo("commits");
  const primero = save(target);
  assert.ok(fs.existsSync(primero.checkpoint));

  fs.writeFileSync(path.join(target, "b.txt"), "dos\n", "utf8");
  execFileSync("git", ["add", "-A"], { cwd: target });
  execFileSync("git", ["commit", "--quiet", "-m", "feat: trabajo posterior al checkpoint"], { cwd: target });

  const segundo = save(target);
  const body = fs.readFileSync(segundo.checkpoint, "utf8");

  assert.match(body, /supersedes: \d{12}-/, "el checkpoint nuevo debe apuntar al anterior");
  assert.match(
    body,
    /feat: trabajo posterior al checkpoint/,
    "el commit hecho DESPUES del checkpoint anterior tiene que aparecer: si no, la seccion es decorativa"
  );
  assert.match(body, /commits_since_previous: [1-9]/, "y el conteo no puede quedarse en 0");
}

console.log("save commits desde el anterior: PASS");
