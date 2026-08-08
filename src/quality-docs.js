// ---------------------------------------------------------------------------
// Documentacion generada desde el contrato (ADR 0007, P14)
//
// Un README que describe umbrales a mano diverge del contrato real la
// primera vez que alguien edita quality-contract.yaml y se olvida de
// actualizar la prosa -- exactamente el mismo problema de dos fuentes de
// verdad que P6 cerro para las superficies. Este documento no se escribe:
// se REGENERA desde quality-contract.yaml y phase-contract.yaml, asi que
// mentir en el exigiria editar el propio contrato que los gates evaluan.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import path from "node:path";
import { loadQualityContract } from "./quality-adjudicate.js";
import { loadPhaseContract } from "./harness.js";

function table(headers, rows) {
  if (rows.length === 0) return "_(ninguno declarado)_\n";
  const headerLine = `| ${headers.join(" | ")} |`;
  const separator = `| ${headers.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${row.join(" | ")} |`).join("\n");
  return [headerLine, separator, body].join("\n");
}

function formatThreshold(gate) {
  if (gate.thresholds && typeof gate.thresholds === "object") {
    return Object.entries(gate.thresholds)
      .map(([tier, value]) => `${tier}=${value}`)
      .join(", ");
  }
  if (Object.prototype.hasOwnProperty.call(gate, "threshold")) return String(gate.threshold);
  return "_(sin umbral)_";
}

// El denominador minimo no es un detalle de implementacion: es lo que separa
// un gate que juzga de uno VACUO. "0 violaciones permitidas" y "0 violaciones
// permitidas, y solo cuenta si se escanearon al menos 10 modulos" son
// controles distintos, y la doc omitia el segundo dato por completo -- quien
// la leia no podia saber si el gate era satisfacible por vacio.
function formatDenominator(gate) {
  const declared = gate.min_denominator;
  if (!declared || !declared.metric) return "_(ninguno)_";
  const minimum = typeof declared.value === "number" ? declared.value : 1;
  return `\`${declared.metric}\` >= ${minimum}`;
}

export function renderQualityDocs({ contract, phaseContract }) {
  const lines = [];
  lines.push("# Contrato de calidad");
  lines.push("");
  lines.push("> Generado por `sdlc quality-docs` desde `quality-contract.yaml` y `phase-contract.yaml`.");
  lines.push("> No editar a mano: se sobreescribe en cada regeneracion. Cambiar el contrato y volver a generar.");
  lines.push("");
  lines.push(`## Nivel de exigencia global\n\n\`enforcement: ${contract.enforcement ?? "observe"}\``);
  lines.push("");

  lines.push("## Tiers");
  lines.push(table(
    ["tier", "descripcion"],
    Object.entries(contract.tiers ?? {}).map(([tier, def]) => [tier, def?.description ?? ""])
  ));
  lines.push("");

  lines.push("## Superficies");
  lines.push(table(
    ["id", "path", "tier", "money_path", "has_ui"],
    (contract.surfaces ?? []).map((surface) => [
      surface.id,
      `\`${surface.path}\``,
      surface.tier,
      String(Boolean(surface.money_path)),
      String(Boolean(surface.has_ui))
    ])
  ));
  lines.push("");

  lines.push("## Probes");
  lines.push(table(
    ["id", "command", "format", "emits", "when_absent"],
    (contract.probes ?? []).map((probe) => [
      probe.id,
      `\`${probe.command}\``,
      probe.format,
      `\`${probe.emits}\``,
      probe.when_absent ?? "warn"
    ])
  ));
  lines.push("");

  lines.push("## Gates");
  lines.push(table(
    ["id", "fase de origen", "metrica", "operador", "umbral", "denominador minimo", "modo", "procedencia"],
    (contract.gates ?? []).map((gate) => [
      gate.id,
      gate.phase ?? "",
      `\`${gate.metric}\``,
      gate.op,
      formatThreshold(gate),
      formatDenominator(gate),
      gate.mode,
      gate.provenance ?? "_(sin declarar)_"
    ])
  ));
  lines.push("");

  if (phaseContract?.phases?.length) {
    lines.push("## Gates por fase (phase-contract.yaml)");
    lines.push("");
    lines.push("Una fase con gates cuya `fase de origen` (tabla anterior) difiere de la fase que los declara los HEREDA: los re-verifica leyendo la evidencia de la fase que los midio, no mide nada propio (ver P7).");
    lines.push("");
    const gatesById = new Map((contract.gates ?? []).map((gate) => [gate.id, gate]));
    const rows = phaseContract.phases
      .filter((phase) => Array.isArray(phase.quality_gates) && phase.quality_gates.length > 0)
      .map((phase) => {
        const own = [];
        const inherited = [];
        for (const gateId of phase.quality_gates) {
          const gate = gatesById.get(gateId);
          const origin = gate?.phase ?? phase.id;
          (origin === phase.id ? own : inherited).push(gateId);
        }
        return [phase.id, own.map((id) => `\`${id}\``).join(", ") || "_(ninguno)_", inherited.map((id) => `\`${id}\``).join(", ") || "_(ninguno)_"];
      });
    lines.push(table(["fase", "gates propios", "gates heredados"], rows));
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function commandQualityDocs(options = {}) {
  const target = path.resolve(options.target ?? process.cwd());
  const loaded = loadQualityContract(target);
  if (!loaded.ok) {
    return { exitCode: 2, payload: { status: "not-configured", code: loaded.code, path: loaded.path } };
  }
  const phaseContract = loadPhaseContract(target);
  const markdown = renderQualityDocs({ contract: loaded.contract, phaseContract });

  const outputRelative = options.out ?? "docs/quality-gates.md";
  const outputAbsolute = path.join(target, outputRelative);

  // Se compara SIEMPRE contra lo que hay comiteado. Antes, este comando solo
  // sabia sobreescribir: `--dry-run` se saltaba la escritura y devolvia
  // `status: ok` sin haber leido el archivo existente, asi que una doc
  // desactualizada era indetectable — justo el modo de fallo (dos fuentes de
  // verdad divergiendo en silencio) que esta pieza existe para cerrar.
  const existing = fs.existsSync(outputAbsolute) ? fs.readFileSync(outputAbsolute, "utf8") : null;
  const drifted = existing !== markdown;
  const divergence = {
    exists: existing !== null,
    drifted,
    reason: existing === null ? "la doc generada no existe todavia" : drifted ? "la doc comiteada no coincide con el contrato actual" : null
  };

  // `--check` no escribe nunca: es el modo para CI. Si la doc no esta al dia,
  // falla y dice que comando la regenera. Se ofrece como comando, no como paso
  // obligatorio del workflow: en este framework ningun control nace en `block`.
  if (options.check) {
    return {
      exitCode: drifted ? 2 : 0,
      payload: {
        status: drifted ? "stale" : "ok",
        path: outputRelative,
        ...divergence,
        hint: drifted ? `regenerar con: sdlc quality-docs --out ${outputRelative}` : undefined
      }
    };
  }

  if (!options["dry-run"]) {
    fs.mkdirSync(path.dirname(outputAbsolute), { recursive: true });
    fs.writeFileSync(outputAbsolute, markdown, "utf8");
  }
  return {
    exitCode: 0,
    payload: {
      status: "ok",
      path: outputRelative,
      bytes: markdown.length,
      dryRun: Boolean(options["dry-run"]),
      // En dry-run esto es lo unico que informa de algo: dice si la corrida
      // real habria cambiado el archivo, en vez de un `ok` incondicional.
      ...divergence
    }
  };
}
