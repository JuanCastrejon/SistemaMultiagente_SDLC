// ---------------------------------------------------------------------------
// Modelo de riesgos de autorizacion (ADR 0008, D1/D4/D7).
//
// Separa los dos ejes que el ADR 0007 habia mezclado: `tier` mide CALIDAD y los
// riesgos declarados por superficie deciden AUTORIZACION. La consecuencia
// perversa que fuerza esta separacion esta medida: con la regla anterior,
// esquivar una firma bastaba con bajar el tier — y eso compraba ademas diez
// puntos menos de cobertura. La gobernanza incentivaba degradar la calidad.
//
// Todo lo de aqui es PURO: entra un contrato, sale un veredicto. Sin git, sin
// disco, sin reloj. Quien adjudica es `phase-gate` (D5); este modulo solo sabe
// decir que obliga y que cambio.
// ---------------------------------------------------------------------------

// Conjunto CERRADO. Ni mas ni menos, y el orden no importa porque la regla es
// un OR. Que sea cerrado es lo que hace que una clave mal escrita
// (`security-critical`, `securityCritical`) no sea un riesgo declarado: no
// aporta un booleano valido a ninguno de los cuatro, asi que el fail-closed de
// `requiredForSurface` obliga. El error de tecleo se paga con una firma de mas,
// nunca con una de menos.
export const RIESGOS_AUTORIZACION = ["money_path", "regulated_data", "security_critical", "state_machine_critical"];

/**
 * ¿Esta superficie obliga a firmar? (ADR 0008, G1)
 *
 * Fail-closed en cada rama, y por el mismo motivo en todas: *no clasificado* no
 * es *no aplica*. Una superficie heredada sin clasificar conserva la obligacion
 * hasta que una revision humana la clasifique.
 */
export function requiredForSurface(surface) {
  if (!surface || typeof surface !== "object" || Array.isArray(surface)) return true;
  for (const riesgo of RIESGOS_AUTORIZACION) {
    const valor = surface[riesgo];
    // Ausente, null, cadena, numero: cualquier cosa que no sea un booleano
    // significa que nadie clasifico ese riesgo.
    if (typeof valor !== "boolean") return true;
    if (valor === true) return true;
  }
  return false;
}

/**
 * Las superficies REALMENTE sin clasificar, dichas por su id (G1).
 *
 * `requiredForSurface` devuelve `true` por DOS motivos distintos que la
 * auditoria de doctor/upgrade no puede permitirse confundir: nadie clasifico
 * un riesgo, o alguien lo clasifico y dio `true`. La segunda es el estado
 * DISEÑADO de un repo con riesgos reales — «el coste aparece exactamente donde
 * el riesgo lo justifica» (ADR 0008) — y no es un hallazgo de doctor: es lo
 * que el gate humano de cada fase va a exigir. Confundirlas dejaba a todo repo
 * plenamente clasificado con un error permanente `authz-surfaces-unclassified`
 * cuyo remedio («clasifica los cuatro riesgos») ya estaba hecho. Encontrado al
 * adoptar 2.0.0 en el consumidor real (un consumidor real, 2026-08-16).
 */
export function superficiesSinClasificar(surfaces) {
  if (!Array.isArray(surfaces)) return [];
  return surfaces
    .filter(
      (surface) =>
        !surface ||
        typeof surface !== "object" ||
        Array.isArray(surface) ||
        RIESGOS_AUTORIZACION.some((riesgo) => typeof surface[riesgo] !== "boolean")
    )
    .map((surface) => surface?.id ?? "(sin id)");
}

/**
 * La identidad de las superficies, que es precondicion de todo lo demas (G1/G2).
 *
 * Un `id` duplicado no se resuelve conservadoramente "por superficie": haria
 * ambiguo el emparejamiento BASE↔HEAD, y una ambiguedad en la identidad se
 * resuelve rechazando el contrato entero, no eligiendo una de las dos lecturas.
 */
export function auditSurfaceIdentity(surfaces) {
  if (!Array.isArray(surfaces)) {
    return { ok: false, code: "authz-contract-surfaces-invalid", detail: "`surfaces` no es una lista" };
  }
  const vistos = new Set();
  const duplicados = new Set();
  const sinId = [];
  for (const [indice, surface] of surfaces.entries()) {
    const id = surface && typeof surface === "object" ? surface.id : undefined;
    if (typeof id !== "string" || id.trim() === "") {
      sinId.push(indice);
      continue;
    }
    if (vistos.has(id)) duplicados.add(id);
    vistos.add(id);
  }
  if (sinId.length > 0) {
    return {
      ok: false,
      code: "authz-contract-surface-id-missing",
      detail: `superficies sin \`id\` en las posiciones ${sinId.join(", ")}: \`id\` es la identidad con la que se compara BASE contra HEAD`
    };
  }
  if (duplicados.size > 0) {
    return {
      ok: false,
      code: "authz-contract-duplicate-surface-id",
      detail: `\`id\` duplicado: ${[...duplicados].join(", ")}. El emparejamiento BASE↔HEAD seria ambiguo`
    };
  }
  return { ok: true, code: null, detail: null };
}

/**
 * ¿Obliga el contrato entero? (D1)
 *
 * `surfaces: []` obliga: es la misma regla que 2.0.0 ya aplica, y por el mismo
 * motivo — un repo sin superficies declaradas no es un repo sin riesgo, es un
 * repo sin clasificar.
 */
export function contractObliga(contract) {
  // `surfaces` ausente, null o que no sea una lista NO es "cero superficies":
  // es un contrato invalido, y se distingue del caso vacio porque el modo de
  // fallo es mucho peor. Renombrar la clave a `Surfaces:` deja que un
  // `(contract.surfaces ?? []).some(...)` —el patron que este repo ya usa en
  // cuatro sitios— evalue un OR sobre el conjunto vacio, que es `false`: con
  // una sola letra mayuscula, ninguna superficie obligaria en ninguna fase.
  //
  // La validez del contrato se comprueba ANTES de evaluar el OR, nunca dentro.
  if (contract?.surfaces !== undefined && !Array.isArray(contract.surfaces)) {
    return {
      obliga: true,
      code: "authz-contract-surfaces-invalid",
      detail: "`surfaces` existe pero no es una lista: el contrato es invalido, no un contrato sin superficies",
      porQue: []
    };
  }
  const surfaces = Array.isArray(contract?.surfaces) ? contract.surfaces : [];
  const identidad = auditSurfaceIdentity(surfaces);
  if (!identidad.ok) {
    return { obliga: true, code: identidad.code, detail: identidad.detail, porQue: [] };
  }
  if (surfaces.length === 0) {
    return {
      obliga: true,
      code: "authz-surfaces-empty",
      detail: "sin superficies declaradas no se puede afirmar que ninguna sea critica",
      porQue: []
    };
  }
  const porQue = surfaces.filter((surface) => requiredForSurface(surface)).map((surface) => surface.id);
  return { obliga: porQue.length > 0, code: null, detail: null, porQue };
}

export const POLITICAS_HUMAN_GATE = ["attestation", "declarative", "none"];

/**
 * La politica declarada, y si es sostenible (D7, G5).
 *
 * Alcance: por REPOSITORIO, con override por FASE. Ni por superficie —una fase
 * se firma una vez, no una vez por superficie, y dos politicas distintas sobre
 * la misma fase no tendrian veredicto definido— ni por slice, que es una unidad
 * de trabajo del evaluado.
 */
export function resolveHumanGatePolicy(contract, phaseId) {
  const bloque = contract?.governance?.humanGate ?? {};
  // El default es `declarative`, NO `attestation`, y la razon esta escrita en
  // las Consecuencias del ADR: "un repo sin riesgos declarados como criticos no
  // paga nada: `declarative` con etiqueta visible. El coste aparece exactamente
  // donde el riesgo lo justifica, que es la propiedad que se buscaba".
  //
  // Con `attestation` por defecto, un repo con cero riesgos y un gate humano
  // tendria que firmar igual — el coste dejaria de seguir al riesgo y el eje
  // volveria a ser configuracion, que es justo lo que D1 separa. Donde el
  // riesgo SI obliga, el OR de `evaluarObligacionDeFase` fuerza `attestation`
  // sin que la politica pueda bajarla.
  const declarada = bloque.policy ?? "declarative";
  const override = phaseId && bloque.overrides ? bloque.overrides[phaseId] : undefined;
  const efectiva = override ?? declarada;

  if (!POLITICAS_HUMAN_GATE.includes(efectiva)) {
    return {
      policy: "attestation",
      code: "authz-policy-invalida",
      detail: `politica desconocida: ${JSON.stringify(efectiva)}. Validas: ${POLITICAS_HUMAN_GATE.join(", ")}`
    };
  }

  if (efectiva === "none") {
    // `none` no se degrada a su version laxa cuando no se sostiene: se RECHAZA.
    // Una politica que no se puede sostener no se aplica a medias.
    const identidad = auditSurfaceIdentity(contract?.surfaces ?? []);
    if (!identidad.ok) {
      return { policy: "attestation", code: "authz-policy-none-invalida", detail: identidad.detail };
    }
    if ((contract?.surfaces ?? []).length === 0) {
      return {
        policy: "attestation",
        code: "authz-policy-none-invalida",
        detail: "`none` exige superficies declaradas: con `surfaces: []` la criticidad es indeterminable"
      };
    }
    const criticas = (contract.surfaces ?? []).filter((surface) => requiredForSurface(surface)).map((s) => s.id);
    if (criticas.length > 0) {
      return {
        policy: "attestation",
        code: "authz-policy-none-invalida",
        detail: `\`none\` exige que ninguna superficie sea critica; obligan: ${criticas.join(", ")}`
      };
    }
  }

  return { policy: efectiva, code: null, detail: null };
}

/**
 * La regla de precedencia entera, en una funcion (G4).
 *
 * El orden de autoridad, y esta escrito como ALGORITMO y no como prosa a
 * proposito: si la obligacion por riesgo se comprobara solo en un comentario,
 * un override podria debilitarla y nadie lo notaria.
 *
 *   1. `phase.human_gate` es la PUERTA. Ninguna politica añade gates humanos
 *      donde el contrato de fases no los declara.
 *   2. La obligacion por riesgo manda DENTRO de la puerta, sin excepcion
 *      configurable.
 *   3. La politica solo decide donde el riesgo no obliga.
 */
export function evaluarObligacionDeFase({ phase, contract }) {
  const tienePuerta = Boolean(phase?.human_gate);
  const obligacion = contractObliga(contract);
  const politica = resolveHumanGatePolicy(contract, phase?.id);

  if (!tienePuerta) {
    return {
      exige: "ninguna",
      porRiesgo: obligacion.obliga,
      policy: politica.policy,
      code: obligacion.code ?? politica.code ?? null,
      detail: obligacion.detail ?? politica.detail ?? null,
      surfacesQueObligan: obligacion.porQue
    };
  }

  const exige = obligacion.obliga || politica.policy === "attestation" ? "attestation" : politica.policy;
  return {
    exige,
    porRiesgo: obligacion.obliga,
    policy: politica.policy,
    code: obligacion.code ?? politica.code ?? null,
    detail: obligacion.detail ?? politica.detail ?? null,
    surfacesQueObligan: obligacion.porQue
  };
}

/**
 * La comparacion BASE→HEAD (D4, G2).
 *
 * Se empareja por `id`, nunca por `path`: un `path` cambia cuando se mueve
 * codigo; un `id` es la identidad que el consumidor declara y mantiene.
 *
 * Split y merge de superficies se tratan como BAJAS a proposito. No hay forma
 * fiable de distinguir "parti `api` en `api-http` y `api-jobs`" de "borre `api`
 * y cree dos superficies sin clasificar": las dos producen el mismo diff del
 * contrato. Ante dos lecturas indistinguibles se elige la que no concede.
 */
// ¿El `path` de HEAD cubre menos arbol que el de BASE?
//
// Se decide sobre los paths DECLARADOS, no sobre los archivos que resuelven: es
// puro, es barato, y es exacto para lo que importa — que el nuevo path este
// DENTRO del viejo. Un movimiento lateral (`apps/api` -> `servicios/api`) no es
// estrechar: puede cubrir mas, menos o lo mismo, y decidirlo pediria comparar
// dos arboles de git. Eso se deja fuera a proposito en vez de fingir que este
// criterio lo cubre.
function normalizarRutaDeSuperficie(valor) {
  const texto = String(valor ?? "").replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
  return texto === "" || texto === "." ? "." : texto;
}

export function estrechaLaSuperficie(pathBase, pathHead) {
  const base = normalizarRutaDeSuperficie(pathBase);
  const head = normalizarRutaDeSuperficie(pathHead);
  if (base === head) return false;
  if (base === ".") return head !== ".";
  return head.startsWith(`${base}/`);
}

/**
 * ¿Se debilito la POLITICA entre BASE y HEAD? (D7)
 *
 * `compararObligacion` mira solo las superficies, y eso dejaba fuera la mitad
 * del modelo: bajar `governance.humanGate.policy` de `attestation` a
 * `declarative` —o meter un override por fase— cambia lo que se exige donde el
 * riesgo no obliga, y no movia ningun `required`. Nadie lo reportaba.
 *
 * No se compara contra un ideal, se compara contra la BASE: lo que estaba
 * mergeado es la referencia, igual que con las superficies.
 */
const ORDEN_DE_EXIGENCIA = { none: 0, declarative: 1, attestation: 2 };

export function compararPolitica(contratoBase, contratoHead, phaseIds = []) {
  const debilitadas = [];
  const fases = [null, ...phaseIds];
  for (const phaseId of fases) {
    const antes = resolveHumanGatePolicy(contratoBase, phaseId);
    const ahora = resolveHumanGatePolicy(contratoHead, phaseId);
    // Una politica invalida ya la reporta `resolveHumanGatePolicy` por su
    // cuenta; aqui solo interesa el movimiento a la baja de una valida.
    if (antes.code || ahora.code) continue;
    if (ORDEN_DE_EXIGENCIA[ahora.policy] < ORDEN_DE_EXIGENCIA[antes.policy]) {
      debilitadas.push({ phaseId: phaseId ?? "(repositorio)", desde: antes.policy, hasta: ahora.policy });
    }
  }
  return debilitadas;
}

export function compararObligacion(surfacesBase, surfacesHead) {
  const identidadBase = auditSurfaceIdentity(surfacesBase ?? []);
  const identidadHead = auditSurfaceIdentity(surfacesHead ?? []);
  if (!identidadBase.ok) return { ok: false, lado: "base", code: identidadBase.code, detail: identidadBase.detail };
  if (!identidadHead.ok) return { ok: false, lado: "head", code: identidadHead.code, detail: identidadHead.detail };

  const porIdBase = new Map((surfacesBase ?? []).map((s) => [s.id, s]));
  const porIdHead = new Map((surfacesHead ?? []).map((s) => [s.id, s]));

  const downgrades = [];
  const bajas = [];
  const altas = [];

  for (const [id, surfaceBase] of porIdBase) {
    const surfaceHead = porIdHead.get(id);
    if (!surfaceHead) {
      bajas.push(id);
      // Una baja solo es downgrade si lo que se fue OBLIGABA. Borrar una
      // superficie que no obligaba no reduce ninguna autorizacion.
      if (requiredForSurface(surfaceBase)) downgrades.push({ id, motivo: "baja", desde: true, hasta: false });
      continue;
    }
    const antes = requiredForSurface(surfaceBase);
    const ahora = requiredForSurface(surfaceHead);
    // Lo que cuenta es la TRANSICION del booleano, no cada mutacion de campo:
    // poner un riesgo en false mientras otro sigue en true no cambia nada.
    if (antes && !ahora) {
      downgrades.push({ id, motivo: "reclasificacion", desde: true, hasta: false });
      continue;
    }
    // Y la BAJA PARCIAL, que no es simetrica con un rename y por eso se mira
    // aparte: la obligacion es un OR por repositorio y NO mira el `path`; el
    // sujeto de la firma SI, porque es el arbol de las superficies. Una
    // superficie que conserva su `id` y su clasificacion y cambia `path: .` por
    // `path: docs/` mantiene la obligacion intacta y VACIA lo que la firma
    // cubre: sale una atestacion criptograficamente valida sobre documentacion
    // mientras el codigo con los privilegios queda fuera del hash.
    if (antes && estrechaLaSuperficie(surfaceBase.path, surfaceHead.path)) {
      downgrades.push({ id, motivo: "baja-parcial", desde: true, hasta: true });
    }
  }

  for (const id of porIdHead.keys()) {
    if (!porIdBase.has(id)) altas.push(id);
  }

  return { ok: true, downgrades, bajas, altas };
}
