// ---------------------------------------------------------------------------
// `phase-status.yaml` declaraba UN solo slice (current_slice/current_phase) y
// el arbitro lo lee para decidir que evalua. En manga-translator-mvp habia tres
// slices en vuelo a la vez: se evaluaba uno y los otros dos no aparecian en
// ningun tablero. El mapa `slices:` es aditivo — el puntero se conserva para
// los workflows que lo grepean — y estos casos fijan las dos compatibilidades
// que importan: un archivo antiguo se comporta igual que antes, y un puntero
// que no esta en el mapa no se resuelve en silencio.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readPhaseStatus } from "../src/harness.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sdlc-phase-status-"));

function writeStatus(name, body) {
  const target = path.join(tempRoot, name);
  fs.mkdirSync(path.join(target, ".github", "agent-state"), { recursive: true });
  fs.writeFileSync(path.join(target, ".github", "agent-state", "phase-status.yaml"), body, "utf8");
  return target;
}

// --- sin archivo -----------------------------------------------------------
const vacio = readPhaseStatus(path.join(tempRoot, "no-existe"));
assert.deepEqual(vacio.pointer, { slice: null, phase: null });
assert.deepEqual(vacio.slices, []);

// --- formato antiguo: solo puntero -----------------------------------------
// Tiene que comportarse EXACTAMENTE como antes del cambio.
const legacy = readPhaseStatus(
  writeStatus("legacy", 'version: 1\ncurrent_slice: "slice-uno"\ncurrent_phase: "F5"\nphases_completed: ["F1"]\n')
);
assert.deepEqual(legacy.pointer, { slice: "slice-uno", phase: "F5" });
assert.equal(legacy.declared, false);
assert.equal(legacy.slices.length, 1);
assert.equal(legacy.slices[0].id, "slice-uno");
assert.equal(legacy.slices[0].isPointer, true);

// --- mapa por slice ---------------------------------------------------------
const multi = readPhaseStatus(
  writeStatus(
    "multi",
    [
      "version: 1",
      'current_slice: "slice-b"',
      'current_phase: "F8"',
      "slices:",
      "  slice-a:",
      '    phase: "F4"',
      '    phase_name: "Validacion"',
      '    phases_completed: ["F1", "F2"]',
      "  slice-b:",
      '    phase: "F8"',
      "  slice-c:",
      '    phase: "F1"',
      ""
    ].join("\n")
  )
);
assert.equal(multi.declared, true);
assert.deepEqual(multi.slices.map((slice) => slice.id).sort(), ["slice-a", "slice-b", "slice-c"]);
assert.equal(multi.slices.filter((slice) => slice.isPointer).length, 1, "solo el apuntado se marca como puntero");
assert.equal(multi.slices.find((slice) => slice.id === "slice-a").phaseName, "Validacion");
assert.deepEqual(multi.slices.find((slice) => slice.id === "slice-a").phasesCompleted, ["F1", "F2"]);

// --- el puntero apunta fuera del mapa ---------------------------------------
// Tablero y mapa se contradicen: se reporta, no se elige uno en silencio.
const unlisted = readPhaseStatus(
  writeStatus("unlisted", ['version: 1', 'current_slice: "slice-z"', 'current_phase: "F8"', "slices:", "  slice-a:", '    phase: "F4"', ""].join("\n"))
);
const pointerEntry = unlisted.slices.find((slice) => slice.id === "slice-z");
assert.ok(pointerEntry, "el slice apuntado tiene que aparecer aunque el mapa no lo declare");
assert.equal(pointerEntry.unlisted, true);

// --- YAML roto: no se pierde el puntero -------------------------------------
const broken = readPhaseStatus(writeStatus("broken", 'version: 1\ncurrent_slice: "slice-roto"\ncurrent_phase: "F2"\nslices: [ {{ esto no es yaml\n'));
assert.equal(broken.parsed, false);
assert.deepEqual(broken.pointer, { slice: "slice-roto", phase: "F2" });
assert.equal(broken.slices[0].id, "slice-roto");

console.log("phase-status multi-slice: PASS");
