// ---------------------------------------------------------------------------
// La senal de recompensa de `skill-eval` (SkillOpt: microsoft/SkillOpt).
//
// SkillOpt puntua ROLLOUTS —el agente ejecuta tareas y se mide su
// comportamiento— y acepta una edicion solo si mejora estrictamente un score
// de validacion HELD-OUT. Aqui todavia no hay rollout: `scoreTask` recibe el
// PROPIO documento de skill y comprueba si contiene ciertas cadenas.
//
// Como el optimizador edita ese mismo documento, la recompensa es jugable por
// construccion. Este test FIJA ese hecho en vez de dejarlo como nota al pie:
// mientras el score sea de presencia de texto, el payload tiene que declararse
// no autoritativo. El dia que exista rollout de verdad, este test falla y
// obliga a actualizar la declaracion — que es justo lo que se quiere.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandSkillEval } from "../src/eval-runner.js";

function skillFixture({ skillBody, tasks }) {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-eval-signal-"));
  const dir = path.join(target, ".github", "skills", "demo", "evals");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(target, ".github", "skills", "demo", "SKILL.md"), skillBody, "utf8");
  const yaml = ["skill: demo", "version: 1", "tasks:"];
  for (const task of tasks) {
    yaml.push(`  - id: ${task.id}`);
    yaml.push(`    description: ${task.id}`);
    yaml.push(`    expected_fields: [${task.field}]`);
    yaml.push(`    split: ${task.split}`);
  }
  fs.writeFileSync(path.join(dir, "g.yaml"), `${yaml.join("\n")}\n`, "utf8");
  return target;
}

const tasks = [
  { id: "t1", field: "manejar_errores_de_red", split: "train" },
  { id: "t2", field: "validar_entrada_del_usuario", split: "val" }
];

// --- LA RECOMPENSA ES JUGABLE: queda fijado con PoC ------------------------
{
  const base = "# demo\nInstrucciones reales de la skill.\n";
  const honest = skillFixture({ skillBody: base, tasks });
  const before = commandSkillEval({ target: honest, skill: "demo" }).payload;
  assert.equal(before.splits.val.scorePercent, 0);

  // "Edicion" que no ensena nada: pega los strings esperados en el documento.
  const gamed = skillFixture({
    skillBody: `${base}\nmanejar_errores_de_red\nvalidar_entrada_del_usuario\n`,
    tasks
  });
  const after = commandSkillEval({ target: gamed, skill: "demo" }).payload;

  assert.equal(
    after.splits.val.scorePercent,
    100,
    "insertar los expected_fields sube el score held-out a 100 sin cambiar comportamiento: esa es la debilidad, y esta fijada a proposito"
  );
  assert.ok(
    after.splits.val.scorePercent > before.splits.val.scorePercent,
    "y ademas APRUEBA un gate de mejora estricta sobre held-out"
  );

  // Por eso el score no puede presentarse como validacion.
  assert.equal(after.authoritative, false, "un score jugable no puede declararse autoritativo");
  assert.equal(after.scoringMode, "document-presence");
  assert.match(after.role, /SkillOpt/, "tiene que decir que el optimizador real es la herramienta externa, no este comando");
  assert.ok(after.limitations.some((l) => l.includes("tools-install --tool skillopt")), "y como conseguirla");
  assert.ok(
    after.limitations.some((line) => line.includes("rollout")),
    "la limitacion principal —que no hay rollout— tiene que estar dicha, no implicita"
  );
}

console.log("skill-eval senal jugable declarada: PASS");

// --- sin held-out, el gate se declara vacuo --------------------------------
{
  const target = skillFixture({
    skillBody: "# demo\ncriterio_a\n",
    tasks: [{ id: "t1", field: "criterio_a", split: "train" }]
  });
  const payload = commandSkillEval({ target, skill: "demo" }).payload;
  assert.equal(payload.heldOut, false);
  assert.equal(payload.gate, "vacuous", "sin tareas val el score se mide contra las mismas tareas que motivaron la edicion");
  assert.equal(payload.gateScorePercent, undefined, "y no puede emitir un numero que parezca el del gate");
}

// --- con held-out, el gate lee validacion, no el global --------------------
{
  const target = skillFixture({
    skillBody: "# demo\ncriterio_a\n",
    tasks: [
      { id: "t1", field: "criterio_a", split: "train" },
      { id: "t2", field: "criterio_ausente", split: "val" }
    ]
  });
  const payload = commandSkillEval({ target, skill: "demo" }).payload;
  assert.equal(payload.heldOut, true);
  assert.equal(payload.splits.train.scorePercent, 100);
  assert.equal(payload.splits.val.scorePercent, 0);
  assert.equal(payload.gate, "not-authoritative", "con held-out pero senal de texto, sigue sin haber cifra de gate");
  assert.equal(payload.gateScorePercent, undefined, "entregar la cifra igual seria pedirle al consumidor que lea la letra chica");
  assert.equal(payload.scorePercent, 50);
}

console.log("skill-eval held-out: PASS");
