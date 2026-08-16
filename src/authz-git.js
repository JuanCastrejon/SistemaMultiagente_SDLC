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
import {
  compararObligacion,
  compararPolitica,
  contractObliga,
  evaluarObligacionDeFase,
  resolveHumanGatePolicy
} from "./authz.js";

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
  // El `./` NO es cosmetico. `git show <ref>:<ruta>` sin el resuelve contra la
  // RAIZ del repo git; con el, contra el CWD. Un consumidor instalado con
  // `sdlc adopt --target apps/extension` tiene su contrato en
  // `apps/extension/quality-contract.yaml`, asi que sin `./` esta funcion leia
  // el contrato de la raiz —o ninguno— y la comparacion BASE->HEAD no corria.
  //
  // Y lo agravante: su hermana `computeTreeHashAtRef` usa `git ls-tree -r`, que
  // SI es relativa al cwd. Las dos mitades del mismo mecanismo discrepaban
  // sobre que archivo es "el contrato", que es exactamente la clase de
  // divergencia silenciosa que este repo persigue en todos los demas sitios.
  const mostrado = git(["show", `${ref}:./${ruta}`], target);
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
export function adjudicarAutorizacion({ target, phaseId, contratoHead, faseHead, fasesHead = null, baseSolicitada = null }) {
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
    // No poder resolver BASE bloquea en una fase CON puerta: ahi si hay algo
    // que autorizar, y sin comparacion no se puede saber que se perdio.
    //
    // En una fase SIN puerta, lo unico que BASE aportaria es descubrir que
    // alguien la quito. Eso importa, pero bloquear TODAS las fases de un repo
    // sin ref remota —un clon nuevo, la maquina de quien desarrolla— convertiria
    // el comando en inusable para lo que no esta autorizando nada. Y el arbitro
    // que cuenta es CI (D5), donde la ref remota existe por construccion:
    // `fetch-depth: 0` es requisito del workflow. Ahi el detector si corre.
    const destino = puerta ? bloqueos : avisos;
    destino.push({ code: base.code, detail: base.detail });
    // El early-return de antes devolvia `enHead.exige` tal cual: para F2/F3 con
    // puerta (sin arbol que atestar) eso era "attestation" cuando la ref remota
    // faltaba y "ninguna" cuando existia — mismo contrato de entrada, salida
    // distinta segun el entorno. La ronda 18 lo declaro; aqui se cierra. La
    // regla del return final aplica igual en las dos salidas.
    return { ok: bloqueos.length === 0, exige: puerta && conArbol ? enHead.exige : "ninguna", bloqueos, avisos, base: null };
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
    } else {
      // Debilitar la POLITICA es un downgrade AUNQUE NINGUNA SUPERFICIE CAMBIE,
      // y por eso esta comprobacion NO puede colgar de que existan downgrades
      // de superficie: `compararObligacion` mira solo `surfaces`, y eso deja
      // fuera la mitad del modelo — la que decide donde el riesgo no obliga.
      // Anidarla dentro del caso "hay downgrades" la hacia inalcanzable
      // justo en el escenario que existe para cubrir.
      //
      // Y se comparan TODAS las fases con override, no solo la que se gatea:
      // nadie invoca el gate de todas las fases en cada corrida, asi que
      // debilitar el override de F5 pasaba limpio por el gate de F8 (ronda 18,
      // mutante M3). El id con override que nadie vuelve a gatear era invisible.
      const idsPolitica = [
        ...new Set([
          String(phaseId),
          ...Object.keys(contratoBase.contract?.governance?.humanGate?.overrides ?? {}),
          ...Object.keys(contratoHead?.governance?.humanGate?.overrides ?? {})
        ])
      ];
      for (const debil of compararPolitica(contratoBase.contract, contratoHead, idsPolitica)) {
        bloqueos.push({
          code: "authz-policy-downgrade",
          detail: `la politica de gate humano bajo de ${debil.desde} a ${debil.hasta} en ${debil.phaseId}: debilitar la politica es un downgrade de autorizacion aunque ninguna superficie cambie`
        });
      }
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
  if (fasesBase.code) {
    // La misma doctrina que el paso 2 con el contrato de calidad: no poder
    // leer el contrato de fases de la BASE no puede parecerse a "no habia
    // ninguna puerta que quitar". La ronda 18 lo reproducjo — YAML roto en
    // BASE con la puerta quitada en HEAD devolvia ok:true sin bloqueos ni
    // avisos: el detector vivia detras de su propia condicion de lectura.
    bloqueos.push({ code: fasesBase.code, detail: fasesBase.detail });
  } else if (fasesBase.presente) {
    // Y no solo la fase que se esta gateando: una fase con puerta BORRADA del
    // contrato de HEAD no la gatea nadie, y el detector anterior solo miraba
    // la fase actual. Se enumeran TODAS las que tenian puerta en la base.
    const conPuertaEnBase = (fasesBase.contract?.phases ?? []).filter((f) => Boolean(f?.human_gate));
    for (const fasePuerta of conPuertaEnBase) {
      const idBase = String(fasePuerta?.id);
      if (Array.isArray(fasesHead?.phases)) {
        const enHead = fasesHead.phases.find((f) => String(f?.id) === idBase);
        if (!enHead) {
          bloqueos.push({
            code: "authz-human-gate-removed",
            detail: `la fase ${idBase} tenia gate humano en la base y desaparecio del contrato de fases. Borrar la fase que sostenia la puerta es quitar la puerta`
          });
        } else if (!Boolean(enHead.human_gate)) {
          bloqueos.push({
            code: "authz-human-gate-removed",
            detail: `la fase ${idBase} tenia gate humano en la base y ya no. \`human_gate\` es la puerta que gobierna todo el modelo de autorizacion: quitarla es el downgrade mas grande posible`
          });
        }
      } else if (idBase === String(phaseId) && !puerta) {
        // Llamadores sin el contrato de fases completo: solo se puede hablar
        // de la fase que se esta adjudicando.
        bloqueos.push({
          code: "authz-human-gate-removed",
          detail: `la fase ${phaseId} tenia gate humano en la base y ya no. \`human_gate\` es la puerta que gobierna todo el modelo de autorizacion: quitarla es el downgrade mas grande posible`
        });
      }
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

/**
 * La auditoria del eje de autorizacion, para `doctor` y `upgrade` (G7).
 *
 * NO adjudica: adjudicar es de `phase-gate` (D5). Esto reporta, y con la
 * severidad que la matriz de G7 fija para cada comando — que no es la misma
 * para todos, y por eso la funcion devuelve `level` en cada hallazgo en vez de
 * un booleano.
 *
 * La fila que rompe el patron, y por eso esta explicada: **BASE irresoluble es
 * `warning` aqui y `blocked` en `phase-gate`**. `doctor` corre en la maquina de
 * quien desarrolla, donde no tener la rama remota es normal —clon nuevo, red
 * caida— y ademas no esta adjudicando nada. El gate si adjudica, y ahi no poder
 * comparar es no poder conceder.
 */
export function auditarAutorizacion(target, contratoHead) {
  const findings = [];

  const obligacion = contractObliga(contratoHead);
  if (obligacion.code === "authz-contract-duplicate-surface-id" || obligacion.code === "authz-contract-surface-id-missing") {
    findings.push({ level: "error", code: obligacion.code, detail: obligacion.detail });
  } else if (obligacion.code === "authz-contract-surfaces-invalid") {
    findings.push({ level: "error", code: obligacion.code, detail: obligacion.detail });
  } else if (obligacion.obliga) {
    findings.push({
      level: "error",
      code: "authz-surfaces-unclassified",
      detail:
        obligacion.porQue.length > 0
          ? `superficies que obligan a firmar: ${obligacion.porQue.join(", ")}. Clasificar los cuatro riesgos en config.surfaces y regenerar con \`sdlc upgrade\``
          : `${obligacion.detail ?? "el contrato obliga a firmar"}. Clasificar los cuatro riesgos en config.surfaces y regenerar con \`sdlc upgrade\``
    });
  }

  const politica = resolveHumanGatePolicy(contratoHead, null);
  if (politica.code) findings.push({ level: "error", code: politica.code, detail: politica.detail });

  const base = resolverBaseDeAutorizacion(target);
  if (!base.ok) {
    findings.push({ level: "warning", code: base.code, detail: base.detail });
    return findings;
  }

  const contratoBase = leerContratoEnRef(target, base.base, "quality-contract.yaml");
  if (contratoBase.code) {
    // Ronda 18, H8: la mitad de auditoria se saltaba en silencio cuando el
    // contrato de la BASE estaba presente pero ilegible — cero hallazgos, igual
    // que si todo estuviera en orden. Una auditoria que calla cuando no puede
    // mirar se lee como una auditoria que miro y no encontro nada.
    findings.push({
      level: "error",
      code: contratoBase.code,
      detail: `no se puede auditar la obligacion de la base: ${contratoBase.detail}`
    });
  } else if (contratoBase.presente) {
    const comparacion = compararObligacion(contratoBase.contract?.surfaces, contratoHead?.surfaces);
    if (!comparacion.ok) {
      findings.push({ level: "error", code: comparacion.code, detail: `${comparacion.lado}: ${comparacion.detail}` });
    } else {
      for (const bajada of comparacion.downgrades) {
        findings.push({
          level: "error",
          code: "authz-downgrade",
          detail: `la superficie \`${bajada.id}\` obligaba a firmar en la base y ya no (${bajada.motivo})`
        });
      }
    }
  }

  return findings;
}
