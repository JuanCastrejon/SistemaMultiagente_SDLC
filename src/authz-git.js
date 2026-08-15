// ---------------------------------------------------------------------------
// La mitad del modelo de autorizacion que SI toca git (ADR 0008, G3/D4).
//
// `src/authz.js` es puro y decide QUE obliga. Este modulo resuelve CONTRA QUE se
// compara y lee los dos contratos en un ref. Separarlos no es estetica: la
// logica de obligacion tiene que poder probarse sin montar un repo, y la
// resolucion de BASE tiene que poder probarse contra repos de verdad.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import path from "node:path";
import YAML from "yaml";
import { readTextIfExists } from "./file-utils.js";
import { compararObligacion, evaluarObligacionDeFase } from "./authz.js";

function git(args, target) {
  const resultado = spawnSync("git", args, { cwd: target, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { ok: resultado.status === 0, stdout: (resultado.stdout ?? "").trim() };
}

/**
 * La rama de integracion DECLARADA. No la que proponga el PR.
 *
 * Este es el hallazgo que el ataque al diseño marco como bloqueante: el guard de
 * frontera resuelve su base por una cadena de candidatos —`--base`,
 * `GITHUB_BASE_REF`, `origin/develop`, `origin/main`— y NUNCA lee
 * `gitFlow.integrationBranch`. Lo que hoy lo protege no es esa cadena: es que el
 * workflow le pasa `--base` interpolado desde la configuracion.
 *
 * `phase-gate` no tiene quien se lo pase, asi que si copiara la cadena heredaria
 * que el evaluado ELIGE contra que se le compara: se empuja `sandbox` con la
 * politica ya bajada, se abre el PR contra `sandbox`, y no existe transicion
 * `true -> false` que detectar porque la base ya trae la politica debil.
 */
export function ramaDeIntegracionDeclarada(target) {
  const crudo = readTextIfExists(path.join(target, ".sdlc", "config.json"));
  if (!crudo) return { ok: false, code: "authz-config-missing", detail: "no hay .sdlc/config.json: no hay rama de integracion declarada" };
  try {
    const rama = JSON.parse(crudo)?.gitFlow?.integrationBranch;
    if (typeof rama !== "string" || rama.trim() === "") {
      return { ok: false, code: "authz-config-missing", detail: "`gitFlow.integrationBranch` no esta declarada en .sdlc/config.json" };
    }
    return { ok: true, rama: rama.trim(), code: null, detail: null };
  } catch (error) {
    return { ok: false, code: "authz-config-missing", detail: `.sdlc/config.json ilegible: ${error.message}` };
  }
}

// Calificar la ref, igual que el guard de frontera y por el mismo ataque: las
// reglas DWIM de gitrevisions prueban `refs/tags/` y `refs/heads/` ANTES que
// `refs/remotes/`, asi que un tag llamado `origin/develop` hace que BASE y HEAD
// sean el mismo arbol y ningun downgrade sea detectable. Dos comprobaciones
// independientes: que resuelva, y que lo resuelto viva bajo `refs/remotes/`.
function calificarRemota(target, rama) {
  const completa = `refs/remotes/origin/${rama}`;
  if (!git(["rev-parse", "--verify", "--quiet", completa], target).ok) return null;
  const simbolica = git(["rev-parse", "--symbolic-full-name", completa], target).stdout;
  return simbolica.startsWith("refs/remotes/") ? simbolica : null;
}

/**
 * BASE para la comparacion de obligacion (G3).
 *
 * Las cinco formas de no poder resolverla bloquean, por la misma doctrina del
 * ADR 0007: no poder medir no puede parecerse a no tener nada que reportar. Sin
 * BASE no se puede saber que se perdio, y lo que no se puede saber no se
 * concede.
 */
export function resolverBaseDeAutorizacion(target, { baseSolicitada = null } = {}) {
  const declarada = ramaDeIntegracionDeclarada(target);
  if (!declarada.ok) return { ok: false, code: declarada.code, detail: declarada.detail };

  // Una base propuesta que no es la declarada NO es una base alternativa: es un
  // intento de elegir contra que se compara. Se acepta que la nombren igual
  // —con o sin el prefijo `origin/`, o ya calificada— y nada mas.
  if (baseSolicitada) {
    const normalizada = String(baseSolicitada)
      .replace(/^refs\/remotes\//, "")
      .replace(/^origin\//, "");
    if (normalizada !== declarada.rama) {
      return {
        ok: false,
        code: "authz-base-mismatch",
        detail: `se pidio comparar contra '${baseSolicitada}' pero la rama de integracion declarada es '${declarada.rama}'. Elegir la base es elegir que downgrades son detectables`
      };
    }
  }

  const calificada = calificarRemota(target, declarada.rama);
  if (!calificada) {
    return {
      ok: false,
      code: "authz-base-unresolvable",
      detail: `no hay ref remota resoluble para la rama declarada '${declarada.rama}'. Traer la rama de integracion (fetch-depth: 0). Un tag o rama local con ese nombre NO sirve, a proposito`
    };
  }

  const mergeBase = git(["merge-base", calificada, "HEAD"], target);
  if (!mergeBase.ok || !mergeBase.stdout) {
    return {
      ok: false,
      code: "authz-base-unreachable",
      detail: `no hay merge-base entre HEAD y ${calificada}: ¿clon superficial? El guard no puede comparar la obligacion contra nada`
    };
  }

  return { ok: true, ref: calificada, base: mergeBase.stdout, code: null, detail: null };
}

// Fases con `human_gate` que NO tienen arbol que atestar. La obligacion
// derivada de riesgos no aplica ahi, y el motivo esta en las Consecuencias del
// ADR 0008: en un repo recien instalado, exigir en F2/F3 una atestacion cuyo
// sujeto es el hash de las superficies produce un bloqueo del que NO SE SALE —
// `signoff --create` devuelve `signoff-empty-subject`, y la salida (arreglar
// `surfaces`) pasa por `quality-contract.yaml`, ruta protegida cuyo permiso se
// aprueba... en F2/F3.
//
// Un control insatisfacible es exactamente el argumento con el que el ADR 0007
// descarto `platform-review`, y su desenlace previsible es que alguien relaje el
// fail-closed bajo presion. Ahi el gate humano conserva su forma actual,
// etiquetado como garantia no verificable.
//
// Se nombra la EXCEPCION y no la inclusion a proposito: un consumidor que añada
// fases nuevas con `human_gate` las tendra cubiertas por defecto.
export const FASES_SIN_ARBOL_QUE_ATESTAR = new Set(["F2", "F3"]);

/**
 * Lee un contrato YAML EN UN REF. Nunca del working tree: el working tree es lo
 * que el evaluado controla, y la mitad izquierda de la comparacion tiene que
 * venir de donde no puede escribir.
 */
export function leerContratoEnRef(target, ref, ruta) {
  const mostrado = git(["show", `${ref}:${ruta}`], target);
  if (!mostrado.ok) return { ok: false, presente: false, contract: null, code: null, detail: `${ruta} no existe en ${ref}` };
  try {
    return { ok: true, presente: true, contract: YAML.parse(mostrado.stdout) ?? {}, code: null, detail: null };
  } catch (error) {
    return {
      ok: false,
      presente: true,
      contract: null,
      code: "authz-base-contract-invalid",
      detail: `${ruta} en ${ref} no es YAML valido: ${error.message}`
    };
  }
}

/**
 * La adjudicacion completa para UNA fase (ADR 0008, D4/D5/G7).
 *
 * Solo `phase-gate` la invoca. `signoff` no adjudica downgrades: normalmente ni
 * siquiera conoce el BASE de la evaluacion, y darle voto repartiria el mismo
 * veredicto entre dos sitios con informacion distinta.
 *
 * Devuelve BLOQUEOS, no un booleano: quien llama necesita el codigo y el detalle
 * para poder decirle a una persona que hacer.
 */
export function adjudicarAutorizacion({ target, phaseId, contratoHead, faseHead, baseSolicitada = null }) {
  const bloqueos = [];
  const avisos = [];

  const puerta = Boolean(faseHead?.human_gate);
  const conArbol = !FASES_SIN_ARBOL_QUE_ATESTAR.has(phaseId);

  // 1. La obligacion derivada de riesgos, sobre el contrato de HEAD.
  const enHead = evaluarObligacionDeFase({ phase: { ...faseHead, id: phaseId }, contract: contratoHead });
  if (enHead.code) {
    // Un contrato invalido o una politica insostenible bloquean por si solos: no
    // se puede derivar una obligacion de algo que no se puede leer.
    bloqueos.push({ code: enHead.code, detail: enHead.detail });
  }

  // 2. La comparacion BASE -> HEAD. Es lo unico que necesita git, y por eso lo
  //    de arriba se puede probar sin montar un repo.
  const base = resolverBaseDeAutorizacion(target, { baseSolicitada });
  if (!base.ok) {
    bloqueos.push({ code: base.code, detail: base.detail });
    return { ok: bloqueos.length === 0, exige: enHead.exige, bloqueos, avisos, base: null };
  }

  const contratoBase = leerContratoEnRef(target, base.base, "quality-contract.yaml");
  if (contratoBase.code) {
    bloqueos.push({ code: contratoBase.code, detail: contratoBase.detail });
  } else if (!contratoBase.presente) {
    // Sin contrato en BASE no hay obligacion anterior contra la que comparar. No
    // es un downgrade —no habia nada que reducir— pero tampoco se afirma que no
    // lo haya: se dice.
    avisos.push({
      code: "authz-base-contract-ausente",
      detail: `quality-contract.yaml no existe en ${base.base.slice(0, 12)}: no hay obligacion anterior contra la que comparar`
    });
  } else {
    const comparacion = compararObligacion(contratoBase.contract?.surfaces, contratoHead?.surfaces);
    if (!comparacion.ok) {
      bloqueos.push({ code: comparacion.code, detail: `${comparacion.lado}: ${comparacion.detail}` });
    } else if (comparacion.downgrades.length > 0) {
      for (const bajada of comparacion.downgrades) {
        bloqueos.push({
          code: "authz-downgrade",
          detail: `la superficie \`${bajada.id}\` obligaba a firmar en la base y ya no (${bajada.motivo}). Un downgrade de autorizacion exige autorizacion de reduccion, no un cambio de contrato`
        });
      }
    }
  }

  // 3. La puerta tambien se puede quitar, y eso es un downgrade (G4 punto 4).
  const fasesBase = leerContratoEnRef(target, base.base, "phase-contract.yaml");
  if (fasesBase.presente && fasesBase.ok) {
    const faseEnBase = (fasesBase.contract?.phases ?? []).find((f) => String(f?.id) === String(phaseId));
    if (faseEnBase && Boolean(faseEnBase.human_gate) && !puerta) {
      bloqueos.push({
        code: "authz-human-gate-removed",
        detail: `la fase ${phaseId} tenia gate humano en la base y ya no. \`human_gate\` es la puerta que gobierna todo el modelo de autorizacion: quitarla es el downgrade mas grande posible`
      });
    }
  }

  // 4. Y la obligacion, solo donde hay algo que atestar.
  if (puerta && conArbol && enHead.exige === "attestation" && enHead.porRiesgo) {
    avisos.push({
      code: "authz-attestation-required",
      detail:
        enHead.surfacesQueObligan.length > 0
          ? `obligan a firmar: ${enHead.surfacesQueObligan.join(", ")}`
          : "el contrato obliga a firmar (superficies sin clasificar)"
    });
  }

  return {
    ok: bloqueos.length === 0,
    exige: puerta && conArbol ? enHead.exige : "ninguna",
    bloqueos,
    avisos,
    base: base.base
  };
}
