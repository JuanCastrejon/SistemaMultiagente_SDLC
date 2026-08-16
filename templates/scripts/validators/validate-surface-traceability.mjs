#!/usr/bin/env node
// VERDICT_STEP: surface-traceability (ADR 0007, P12).
//
// Una superficie declarada en config.surfaces cuyo path no existe en disco es
// el mismo modo de fallo que "surface-path-unresolved" en quality-contract.yaml
// (P6), pero config.surfaces alimenta mas que el contrato de calidad: tambien
// CODEOWNERS-ish (`surfacesTable`) y la matriz de trazabilidad. Sin este
// chequeo, una superficie renombrada o borrada queda "declarada" en config
// mucho despues de dejar de existir.
import fs from "node:fs";
import path from "node:path";
import { fail, ok } from "./_shared.mjs";

const target = process.cwd();
const configPath = path.join(target, ".sdlc", "config.json");
if (!fs.existsSync(configPath)) {
  fail(`no existe ${path.relative(target, configPath)}: no hay superficies que trazar`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const surfaces = Array.isArray(config.surfaces) ? config.surfaces : [];
// Cero superficies no es "todo en orden": es un repo sin configurar, y con
// esta misma salida en verde nadie lo notaba. El instalador ya no escribe
// superficies de ejemplo, asi que declararlas es un paso explicito.
if (surfaces.length === 0) {
  fail("config.surfaces esta vacio: no hay nada que trazar y ningun gate mide nada. Declarar las superficies reales del repo");
  process.exit(1);
}

const missing = surfaces.filter((surface) => !fs.existsSync(path.join(target, surface.path)));

if (missing.length > 0) {
  fail(`${missing.length} superficie(s) declaradas en config.surfaces no existen en disco: ${missing.map((s) => `${s.id} (${s.path})`).join(", ")}`);
  process.exit(1);
}
ok(`${surfaces.length} superficie(s) trazadas, todas existen en disco`);
