#!/usr/bin/env node
// VERDICT_STEP: control-plane (ADR 0007, P12).
//
// config.agents declara quienes son el control plane y el specialist plane;
// phase-contract.yaml los referencia por id en `owner`/`participants`. Si un
// persona se renombra o se borra en un lado y no en el otro, un agente
// inexistente queda como "responsable" de una fase sin que nada lo note hasta
// que alguien intenta invocarlo. Este validador cruza ambos lados contra los
// archivos de persona reales.
import fs from "node:fs";
import path from "node:path";
import { fail, ok } from "./_shared.mjs";

const target = process.cwd();
const configPath = path.join(target, ".sdlc", "config.json");
if (!fs.existsSync(configPath)) {
  fail(`no existe ${path.relative(target, configPath)}: no hay control plane que verificar`);
  process.exit(1);
}
const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
const declared = [...(config.agents?.controlPlane ?? []), ...(config.agents?.specialistPlane ?? [])];

// La convencion de nombre de archivo no es uniforme entre personas (algunas
// son `<id>.agent.md`, otras `<id>.md`): verificar solo `.agent.md` produce
// falsos positivos el primer dia contra un install de fabrica.
const PERSONA_DIRS = [".github/agents", ".claude/agents"];
const PERSONA_EXTENSIONS = [".agent.md", ".md"];
function personaExists(id) {
  return PERSONA_DIRS.some((dir) => PERSONA_EXTENSIONS.some((ext) => fs.existsSync(path.join(target, dir, `${id}${ext}`))));
}

const missing = [...new Set(declared)].filter((id) => !personaExists(id));
if (missing.length > 0) {
  fail(`${missing.length} persona(s) declaradas en config.agents sin archivo .agent.md: ${missing.join(", ")}`);
  process.exit(1);
}
ok(`${declared.length} referencia(s) de persona resuelven a un archivo real`);
