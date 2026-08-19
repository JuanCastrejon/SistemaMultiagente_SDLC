// ---------------------------------------------------------------------------
// 2.0.6: `doctor` era CIEGO al caso en que un override aceptado ya habia sido
// pisado con la plantilla del framework.
//
// `collectDrift` consultaba `overrides.yaml` unicamente dentro de la rama
// "el archivo difiere de la plantilla". Un archivo gestionado cuyo override
// fue clobbereado COINCIDE con la plantilla, asi que caia fuera de esa rama y
// no producia hallazgo de ningun tipo: ni `managed-file-drift`, ni
// `managed-file-override`, ni `managed-file-override-stale`. El registro de
// `overrides.yaml` se evaporaba en silencio.
//
// Consecuencia medida en un consumidor real: el clobber de 2.0.2 se llevo por
// delante `openspec/specs/project-phases/spec.md` (273 lineas con la ruta de
// fases del proyecto) y `openspec/specs/business-production-readiness/spec.md`.
// La reparacion manual de 2.0.3 restauro otros archivos pero se salto esos dos,
// y `doctor` siguio dando el repo por limpio durante 3 dias con las entradas
// intactas en `overrides.yaml` apuntando a un sha que ya no estaba en ninguna
// parte.
//
// Segundo caso, misma raiz: una eliminacion aceptada (`deleted: true`, que
// 2.0.3 introdujo del lado de `upgrade`) se reportaba como
// `managed-file-missing` en nivel error, para siempre. `doctor` no conocia el
// campo que el propio `upgrade` escribe.
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

async function doctorFindings(dir) {
  const result = await run(["doctor", "--target", dir, "--json"]);
  return result.payload.findings ?? [];
}

function firstManagedPath(dir) {
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, ".sdlc", "install-manifest.json"), "utf8"));
  assert.ok(manifest.managedFiles.length > 0, "el install de fixture debe dejar al menos un archivo gestionado");
  return manifest.managedFiles[0].path;
}

// --- (a) override pisado con la plantilla: debe reportarse STALE, no silencio
{
  const dir = mkTarget("sdlc-doctor-override-clobbered-");
  await install(dir);

  const targetPath = firstManagedPath(dir);
  const absolute = path.join(dir, targetPath);
  const plantilla = fs.readFileSync(absolute, "utf8");
  const customizado = `${plantilla}\n# customizacion local del consumidor\n`;
  fs.writeFileSync(absolute, customizado, "utf8");

  const accept = await run(["upgrade", "--target", dir, "--accept-managed", targetPath, "--json"]);
  assert.equal(accept.exitCode, 0, JSON.stringify(accept.payload));
  assert.deepEqual(accept.payload.accepted, [targetPath]);

  // Con el override vigente, doctor lo reporta como divergencia declarada.
  const vigente = await doctorFindings(dir);
  assert.ok(
    vigente.some((f) => f.code === "managed-file-override" && f.path === targetPath),
    "un override intacto debe reportarse como managed-file-override"
  );

  // Ahora se reproduce el clobber: el archivo vuelve a ser identico a la
  // plantilla del framework, pero `overrides.yaml` sigue declarando el sha del
  // contenido local que se acepto. Es exactamente el estado en que quedo el
  // consumidor tras el upgrade defectuoso de 2.0.2.
  fs.writeFileSync(absolute, plantilla, "utf8");
  const overrides = YAML.parse(fs.readFileSync(path.join(dir, ".sdlc", "overrides.yaml"), "utf8"));
  const entry = overrides.overrides.find((candidate) => candidate.path === targetPath);
  assert.ok(entry, "el override debe seguir registrado tras el clobber");

  const trasClobber = await doctorFindings(dir);
  const relativas = trasClobber.filter((f) => f.path === targetPath);
  assert.notEqual(
    relativas.length,
    0,
    "BUG 2.0.2-2.0.5: doctor no emitia NINGUN hallazgo para un override pisado con la plantilla"
  );
  const stale = relativas.find((f) => f.code === "managed-file-override-stale");
  assert.ok(stale, "un override cuyo archivo ya no coincide con lo aceptado debe reportarse como stale");
  assert.equal(stale.acceptedSha256, entry.sha256, "el hallazgo debe exponer el sha que se acepto en su dia");
  assert.notEqual(
    stale.actualSha256,
    stale.acceptedSha256,
    "stale significa que el disco ya no es lo aceptado; si coincidieran seria un override vigente"
  );

  console.log("doctor: override pisado con la plantilla se reporta stale: PASS");
}

// --- (b) eliminacion aceptada: no es un archivo que falte -----------------
{
  const dir = mkTarget("sdlc-doctor-deleted-accepted-");
  await install(dir);

  const targetPath = firstManagedPath(dir);
  const absolute = path.join(dir, targetPath);
  fs.rmSync(absolute);

  const accept = await run(["upgrade", "--target", dir, "--accept-managed", targetPath, "--json"]);
  assert.equal(accept.exitCode, 0, JSON.stringify(accept.payload));
  assert.equal(fs.existsSync(absolute), false);

  const overrides = YAML.parse(fs.readFileSync(path.join(dir, ".sdlc", "overrides.yaml"), "utf8"));
  const entry = overrides.overrides.find((candidate) => candidate.path === targetPath);
  assert.equal(entry?.deleted, true, "precondicion: upgrade registra la eliminacion como deliberada");

  const findings = await doctorFindings(dir);
  assert.equal(
    findings.some((f) => f.code === "managed-file-missing" && f.path === targetPath),
    false,
    "BUG: una eliminacion aceptada se reportaba como managed-file-missing (error) para siempre"
  );
  const declarada = findings.find((f) => f.code === "managed-file-override" && f.path === targetPath);
  assert.ok(declarada, "la eliminacion aceptada debe reportarse como divergencia declarada");
  assert.equal(declarada.deleted, true, "el hallazgo debe distinguir eliminacion de divergencia de contenido");

  console.log("doctor: eliminacion aceptada no se reporta como archivo faltante: PASS");
}

// --- (c) archivo que falta SIN override sigue siendo error ----------------
{
  const dir = mkTarget("sdlc-doctor-missing-sin-override-");
  await install(dir);

  const targetPath = firstManagedPath(dir);
  fs.rmSync(path.join(dir, targetPath));

  const findings = await doctorFindings(dir);
  assert.ok(
    findings.some((f) => f.code === "managed-file-missing" && f.path === targetPath),
    "no-regresion: sin override aceptado, un gestionado ausente sigue siendo managed-file-missing"
  );

  console.log("doctor: gestionado ausente sin override sigue en error: PASS");
}
