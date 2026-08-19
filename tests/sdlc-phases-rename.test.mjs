// ---------------------------------------------------------------------------
// 2.1.0: la spec de fases del framework pasa de
// `openspec/specs/project-phases/spec.md` a `openspec/specs/sdlc-phases/spec.md`
// y la ruta anterior SALE del set gestionado.
//
// El defecto que esto cierra no es un bug de codigo: es de nombres y de
// propiedad. La spec canoniza las fases del PROCESO (F0-F17), iguales en todo
// repo que instale el framework, pero se llamaba `project-phases`, que invita a
// la lectura contraria. Un consumidor real escribio ahi 273 lineas de hoja de
// ruta de producto (F0 Gobierno ... F7 Cierre) y, por ser ruta gestionada, el
// upgrade defectuoso de 2.0.2 la sustituyo por la plantilla de 62 lineas.
//
// PRECISION SOBRE EL ALCANCE: la perdida silenciosa ya no es posible desde
// 2.0.3 — hoy ese mismo upgrade BLOQUEA con `status: conflict` en vez de pisar
// el archivo. Lo que 2.1.0 arregla no es la perdida, es la causa de que el
// archivo estuviera ahi: mientras el framework sea dueño de una ruta cuyo
// nombre promete lo contrario, el consumidor sigue arrastrando conflicto y
// override permanentes por un archivo que nunca fue del framework, y `F1` sigue
// significando dos cosas distintas en el mismo repo.
//
// Lo que estos casos protegen:
//   (a) install nuevo escribe la ruta nueva y NO la vieja
//   (b) `doctor` exige la nueva y ya no la vieja
//   (c) un consumidor con contenido propio en la ruta vieja lo conserva Y el
//       upgrade deja de conflictuar por el -- la garantia central de esta version
//   (d) un override sobre un path que el framework ya no gestiona se reporta
//       como `managed-file-override-orphan` en vez de desaparecer del informe
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import YAML from "yaml";
import { run } from "../src/cli.js";

const OLD_PATH = "openspec/specs/project-phases/spec.md";
const NEW_PATH = "openspec/specs/sdlc-phases/spec.md";

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

async function doctorFindings(dir) {
  const result = await run(["doctor", "--target", dir, "--json"]);
  return result.payload.findings ?? [];
}

function writeFile(dir, relativePath, content) {
  const absolute = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content, "utf8");
  return absolute;
}

// --- (a) install nuevo: ruta nueva si, ruta vieja no ----------------------
{
  const dir = mkTarget("sdlc-phases-install-");
  await install(dir);

  assert.equal(fs.existsSync(path.join(dir, NEW_PATH)), true, "install debe escribir la spec de fases en la ruta nueva");
  assert.equal(
    fs.existsSync(path.join(dir, OLD_PATH)),
    false,
    "install NO debe escribir nada en openspec/specs/project-phases/: esa ruta es del consumidor"
  );

  const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".sdlc", "install-manifest.json"), "utf8"));
  const gestionados = manifest.managedFiles.map((entry) => entry.path);
  assert.ok(gestionados.includes(NEW_PATH), "la ruta nueva debe estar en el manifiesto");
  assert.equal(
    gestionados.includes(OLD_PATH),
    false,
    "la ruta vieja NO debe estar gestionada: es lo que permitia sobreescribir la hoja de ruta del consumidor"
  );

  const contenido = fs.readFileSync(path.join(dir, NEW_PATH), "utf8");
  assert.match(contenido, /SDLC Phases Specification/, "el titulo debe decir SDLC, no Project");

  console.log("sdlc-phases: install escribe la ruta nueva y deja libre la vieja: PASS");
}

// --- (b) doctor exige la nueva, no la vieja ------------------------------
{
  const dir = mkTarget("sdlc-phases-doctor-canonical-");
  await install(dir);

  const limpio = await doctorFindings(dir);
  assert.equal(
    limpio.some((f) => f.code === "openspec-canonical-missing"),
    false,
    "un install recien hecho no puede reclamar una spec canonica ausente"
  );

  // Sin la ruta NUEVA, doctor debe reclamar.
  fs.rmSync(path.join(dir, NEW_PATH));
  const sinNueva = await doctorFindings(dir);
  assert.ok(
    sinNueva.some((f) => f.code === "openspec-canonical-missing" && f.path === NEW_PATH),
    "doctor debe exigir openspec/specs/sdlc-phases/spec.md"
  );
  assert.equal(
    sinNueva.some((f) => f.code === "openspec-canonical-missing" && f.path === OLD_PATH),
    false,
    "doctor NO debe exigir la ruta vieja: la hoja de ruta del consumidor no es requisito del framework"
  );

  console.log("sdlc-phases: doctor exige la ruta nueva y no la vieja: PASS");
}

// --- (c) contenido propio del consumidor en la ruta vieja SOBREVIVE ------
{
  const dir = mkTarget("sdlc-phases-consumer-content-");
  await install(dir);

  // El consumidor escribe SU hoja de ruta donde el nombre le invitaba a
  // escribirla. Es literalmente el caso que destruyo un repo real.
  const hojaDeRuta = [
    "# Project Phases Specification",
    "",
    "## Purpose",
    "",
    "Ruta de trabajo de ESTE proyecto: F0 Gobierno -> F7 Cierre-Operacion.",
    "",
    "### Requirement: Estructura de fases",
    "",
    "El proyecto SHALL reconocer 8 fases con criterios de entrada y salida.",
    ""
  ].join("\n");
  writeFile(dir, OLD_PATH, hojaDeRuta);

  const upgrade = await run(["upgrade", "--target", dir, "--json"]);
  // GARANTIA CENTRAL DE 2.1.0. Antes de 2.0.3 este upgrade sobreescribia el
  // archivo en silencio. Entre 2.0.3 y 2.0.6 ya no lo perdia, pero BLOQUEABA
  // con `status: conflict` y obligaba a un `--accept-managed` sobre un archivo
  // que nunca fue del framework: ceremonia permanente por un error de nombre.
  // Desde 2.1.0 la ruta no es gestionada y el upgrade pasa sin decir nada de
  // ella, que es lo correcto para un archivo del consumidor.
  assert.equal(upgrade.exitCode, 0, `el upgrade no debe conflictuar por un archivo que ya no gestiona: ${JSON.stringify(upgrade.payload)}`);
  assert.notEqual(upgrade.payload?.status, "conflict", "openspec/specs/project-phases/ no puede generar conflicto: no es del framework");
  assert.equal(
    (upgrade.payload?.conflicts ?? []).some((conflict) => conflict.path === OLD_PATH),
    false,
    "la ruta del consumidor no puede aparecer en la lista de conflictos"
  );

  assert.equal(
    fs.readFileSync(path.join(dir, OLD_PATH), "utf8"),
    hojaDeRuta,
    "el framework no puede tocar openspec/specs/project-phases/"
  );
  assert.equal(fs.existsSync(path.join(dir, NEW_PATH)), true, "la spec del framework sigue escribiendose en su propia ruta");

  // Y sobrevive a mas de una corrida, que es como se perdio la primera vez.
  const otra = await run(["upgrade", "--target", dir, "--json"]);
  assert.equal(otra.exitCode, 0, JSON.stringify(otra.payload));
  assert.equal(
    fs.readFileSync(path.join(dir, OLD_PATH), "utf8"),
    hojaDeRuta,
    "el contenido del consumidor debe sobrevivir a upgrades sucesivos"
  );

  // Tampoco puede reportarse como drift: no es un archivo gestionado.
  const findings = await doctorFindings(dir);
  assert.equal(
    findings.some((f) => f.path === OLD_PATH && f.code === "managed-file-drift"),
    false,
    "una ruta que el framework no gestiona no puede producir drift"
  );

  console.log("sdlc-phases: la hoja de ruta del consumidor sobrevive al upgrade: PASS");
}

// --- (d) override sobre un path ya no gestionado se reporta como huerfano -
{
  const dir = mkTarget("sdlc-phases-orphan-override-");
  await install(dir);

  // Se simula el estado que deja un consumidor que venia de una version en la
  // que ese path SI estaba gestionado y tenia override aceptado.
  const overridesPath = path.join(dir, ".sdlc", "overrides.yaml");
  writeFile(dir, OLD_PATH, "# hoja de ruta del consumidor\n");
  fs.mkdirSync(path.dirname(overridesPath), { recursive: true });
  fs.writeFileSync(
    overridesPath,
    YAML.stringify({
      version: 1,
      overrides: [
        {
          path: OLD_PATH,
          sha256: "0".repeat(64),
          reason: "divergencia local aceptada en upgrade",
          acceptedAt: "2026-08-16T06:06:51.461Z",
          frameworkVersion: "2.0.0"
        }
      ]
    }),
    "utf8"
  );

  const findings = await doctorFindings(dir);
  const huerfano = findings.find((f) => f.code === "managed-file-override-orphan" && f.path === OLD_PATH);
  assert.ok(
    huerfano,
    "un override sobre un path que el framework ya no gestiona debe reportarse, no desaparecer del informe"
  );
  assert.equal(huerfano.existsOnDisk, true, "el hallazgo debe decir si el archivo sigue en disco");

  console.log("sdlc-phases: override sobre path no gestionado se reporta huerfano: PASS");
}
