// ---------------------------------------------------------------------------
// El modelo de riesgos de autorizacion (ADR 0008).
//
// Todo lo de aqui es PURO: entra un contrato, sale un veredicto. Sin git, sin
// disco, sin reloj. Esa frontera es la razon de que estos casos existan — la
// logica de obligacion tiene que poder probarse sin montar un repo, y lo que
// necesita git (resolver BASE, leer un contrato en un ref) se prueba aparte, en
// la suite de regresion, contra repos de verdad.
//
// Casi todos estos casos salen de un ataque adversarial al DISEÑO, hecho antes
// de escribir el cableado. Cuatro bloqueantes y cinco serios, y varios de ellos
// se veian como "eso obviamente no pasa" hasta que alguien escribio la
// secuencia exacta.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";
import { superficiesSinClasificar,
  RIESGOS_AUTORIZACION,
  auditSurfaceIdentity,
  POLITICAS_HUMAN_GATE,
  compararObligacion,
  compararPolitica,
  contractObliga,
  estrechaLaSuperficie,
  evaluarObligacionDeFase,
  requiredForSurface,
  resolveHumanGatePolicy
} from "../src/authz.js";

const limpia = (id, extra = {}) => ({
  id,
  path: "src",
  tier: "standard",
  money_path: false,
  regulated_data: false,
  security_critical: false,
  state_machine_critical: false,
  ...extra
});

// --- 1. `required`: fail-closed en cada rama ------------------------------
// *No clasificado* no es *no aplica*. Una superficie heredada sin clasificar
// conserva la obligacion hasta que una revision humana la clasifique.
assert.equal(requiredForSurface({ id: "a", path: "src", tier: "core" }), true, "sin clasificar obliga");
assert.equal(requiredForSurface(limpia("a")), false, "los cuatro en false NO obligan");
assert.equal(requiredForSurface(null), true, "lo que no es un objeto obliga");
assert.equal(requiredForSurface([]), true, "una lista no es una superficie");

// Los CUATRO nombres, escritos a mano y comparados contra la constante. Sin
// esto, el barrido de abajo deriva sus casos del MISMO array que un mutante
// vaciaria: quitar `state_machine_critical` del conjunto cerrado hacia que el
// test dejara de probarlo y el mutante sobrevivia. Un caso que saca su lista de
// lo que prueba no prueba nada.
assert.deepEqual(
  [...RIESGOS_AUTORIZACION].sort(),
  ["money_path", "regulated_data", "security_critical", "state_machine_critical"],
  "el conjunto de riesgos es CERRADO: cuatro, y estos cuatro"
);
for (const riesgo of ["money_path", "regulated_data", "security_critical", "state_machine_critical"]) {
  assert.equal(requiredForSurface(limpia("a", { [riesgo]: true })), true, `${riesgo}: true obliga`);
  // Un valor que NO es booleano no es una clasificacion: es ruido. Y obliga,
  // porque el fail-closed no distingue "mal escrito" de "sin escribir".
  for (const basura of ["false", "no", 0, null, undefined, {}]) {
    assert.equal(requiredForSurface(limpia("a", { [riesgo]: basura })), true, `${riesgo}: ${JSON.stringify(basura)} obliga`);
  }
}

// La clave MAL ESCRITA. El ataque decia: "las claves desconocidas se ignoran,
// asi que `securityCritical` en camelCase apaga la obligacion". No la apaga —
// pero por una razon que hay que fijar con un caso, no dejar al azar: la clave
// desconocida no aporta un booleano valido a ninguno de los CUATRO nombres
// exactos, asi que el fail-closed de arriba sigue obligando. El error de tecleo
// se paga con una firma de MAS, nunca con una de menos.
assert.equal(
  requiredForSurface({ id: "a", path: "src", tier: "core", securityCritical: false, moneyPath: false }),
  true,
  "los nombres en camelCase NO son los riesgos declarados"
);
assert.equal(
  requiredForSurface({ ...limpia("a"), "security-critical": true }),
  false,
  "una clave con guion tampoco es un riesgo: no añade obligacion ni la quita"
);

// --- 2. la validez del contrato se comprueba ANTES del OR -----------------
// Este es el bloqueante que mas barato habria sido dejar pasar: renombrar la
// clave a `Surfaces:` hace que un `(contract.surfaces ?? []).some(...)` evalue
// un OR sobre el conjunto vacio, que es `false`. Con una sola letra mayuscula,
// ninguna superficie obligaria en ninguna fase.
assert.equal(contractObliga({ surfaces: [] }).obliga, true, "`surfaces: []` obliga");
assert.equal(contractObliga({ Surfaces: [limpia("a")] }).code, "authz-surfaces-empty", "la clave mal escrita deja el contrato sin superficies, y eso obliga");
assert.equal(contractObliga({ Surfaces: [limpia("a")] }).obliga, true);
assert.equal(contractObliga({ surfaces: null }).code, "authz-contract-surfaces-invalid");
assert.equal(contractObliga({ surfaces: { a: 1 } }).code, "authz-contract-surfaces-invalid");
assert.equal(contractObliga({ surfaces: { a: 1 } }).obliga, true, "un contrato invalido NUNCA concede");

// Un `id` duplicado invalida el CONTRATO, no "esa superficie": haria ambiguo el
// emparejamiento BASE<->HEAD, y una ambiguedad de identidad no se resuelve
// eligiendo una de las dos lecturas.
assert.equal(contractObliga({ surfaces: [limpia("a"), limpia("a")] }).code, "authz-contract-duplicate-surface-id");
assert.equal(contractObliga({ surfaces: [{ path: "src", tier: "core" }] }).code, "authz-contract-surface-id-missing");

// --- 3. la politica solo decide donde el riesgo NO obliga ----------------
{
  const critico = { surfaces: [limpia("a", { security_critical: true })] };
  const limpio = { surfaces: [limpia("a")] };

  // El default es `declarative`, no `attestation`: un repo sin riesgos
  // declarados como criticos no paga nada. Con `attestation` por defecto, el
  // coste dejaria de seguir al riesgo y el eje volveria a ser configuracion —
  // justo lo que D1 separa.
  assert.equal(resolveHumanGatePolicy(limpio, "F13").policy, "declarative");

  // Y ningun override puede debilitar donde el riesgo obliga. Esto se comprueba
  // sobre el ALGORITMO, no sobre la prosa: si la regla viviera solo en un
  // comentario, un override la borraria y nadie lo notaria.
  for (const politica of ["declarative", "none"]) {
    const conOverride = {
      ...critico,
      governance: { humanGate: { policy: politica, overrides: { F13: politica } } }
    };
    assert.equal(
      evaluarObligacionDeFase({ phase: { id: "F13", human_gate: true }, contract: conOverride }).exige,
      "attestation",
      `la politica \`${politica}\` no puede bajar una obligacion derivada de riesgo`
    );
  }

  // `none` no se degrada a su version laxa cuando no se sostiene: se RECHAZA.
  const noneConCriticas = resolveHumanGatePolicy({ ...critico, governance: { humanGate: { policy: "none" } } }, "F13");
  assert.equal(noneConCriticas.policy, "attestation");
  assert.equal(noneConCriticas.code, "authz-policy-none-invalida");
  assert.equal(
    resolveHumanGatePolicy({ surfaces: [], governance: { humanGate: { policy: "none" } } }, "F13").code,
    "authz-policy-none-invalida",
    "`none` con superficies vacias no se puede sostener"
  );
  assert.equal(resolveHumanGatePolicy({ ...limpio, governance: { humanGate: { policy: "none" } } }, "F13").policy, "none");

  // Una politica desconocida cae al lado que protege, y lo dice.
  const rara = resolveHumanGatePolicy({ ...limpio, governance: { humanGate: { policy: "quizas" } } }, "F13");
  assert.equal(rara.policy, "attestation");
  assert.equal(rara.code, "authz-policy-invalida");

  // La PUERTA manda: ninguna politica añade gates humanos donde el contrato de
  // fases no los declara.
  assert.equal(evaluarObligacionDeFase({ phase: { id: "F7", human_gate: false }, contract: critico }).exige, "ninguna");
  // Tres estados, no un booleano: con un booleano, `declarative` y `none` serian
  // indistinguibles y una lectura literal borraria un bloqueo que hoy existe.
  assert.equal(evaluarObligacionDeFase({ phase: { id: "F13", human_gate: true }, contract: limpio }).exige, "declarative");
}

// --- 4. la comparacion BASE -> HEAD --------------------------------------
{
  const critica = (id, extra = {}) => limpia(id, { security_critical: true, ...extra });

  // Reclasificar de obligar a no obligar es el caso central.
  const reclasificada = compararObligacion([critica("a")], [limpia("a")]);
  assert.equal(reclasificada.downgrades.length, 1);
  assert.equal(reclasificada.downgrades[0].motivo, "reclasificacion");

  // Una BAJA de algo que obligaba tambien lo es: la continuidad no se puede
  // demostrar, y ante dos lecturas indistinguibles se elige la que no concede.
  assert.equal(compararObligacion([critica("a")], []).downgrades[0].motivo, "baja");
  // Pero borrar una superficie que NO obligaba no reduce ninguna autorizacion.
  assert.equal(compararObligacion([limpia("a")], []).downgrades.length, 0);

  // REUSAR un `id` que obligaba para una superficie nueva que no obliga es un
  // match, no un alta: y se ve como la reclasificacion que es.
  assert.equal(compararObligacion([critica("a")], [limpia("a", { path: "otro" })]).downgrades.length, 1);

  // SPLIT y MERGE se tratan como bajas a proposito: "parti `api` en dos" y
  // "borre `api` y cree dos sin clasificar" producen el MISMO diff.
  const split = compararObligacion([critica("api")], [critica("api-http"), critica("api-jobs")]);
  assert.equal(split.downgrades.length, 1, "el id que desaparece es una baja");
  assert.deepEqual(split.altas.sort(), ["api-http", "api-jobs"]);

  // Un alta NO es downgrade, y un rename con `id` estable tampoco por si mismo.
  assert.equal(compararObligacion([], [critica("a")]).downgrades.length, 0);
  assert.equal(compararObligacion([critica("a")], [critica("a", { path: "servicios/api" })]).downgrades.length, 0);

  // Lo que cuenta es la TRANSICION del booleano: bajar un riesgo mientras otro
  // sigue en true no cambia nada, porque la obligacion seguia siendo `true`.
  const sigueObligando = compararObligacion(
    [limpia("a", { money_path: true, security_critical: true })],
    [limpia("a", { money_path: false, security_critical: true })]
  );
  assert.equal(sigueObligando.downgrades.length, 0);

  // Y la BAJA PARCIAL: conservar la clasificacion y estrechar el `path` deja la
  // obligacion intacta y vacia lo que la firma cubre.
  const estrechada = compararObligacion([critica("a", { path: "." })], [critica("a", { path: "docs" })]);
  assert.equal(estrechada.downgrades.length, 1);
  assert.equal(estrechada.downgrades[0].motivo, "baja-parcial");
  assert.equal(estrechaLaSuperficie(".", "docs/"), true);
  assert.equal(estrechaLaSuperficie("apps/api", "apps/api/src"), true);
  assert.equal(estrechaLaSuperficie("apps/api", "servicios/api"), false, "un movimiento lateral no es estrechar");
  assert.equal(estrechaLaSuperficie("src", "src/"), false, "la barra final no cambia la ruta");

  // Reclasificar Y estrechar el path A LA VEZ produce UN solo downgrade, no dos:
  // el `continue` tras la reclasificacion existe para eso. Sin este caso, quitar
  // ese `continue` sobrevivia — ningun otro combinaba las dos transiciones.
  const ambas = compararObligacion(
    [critica("a", { path: "." })],
    [limpia("a", { path: "docs" })]
  );
  assert.equal(ambas.downgrades.length, 1, JSON.stringify(ambas.downgrades));
  assert.equal(ambas.downgrades[0].motivo, "reclasificacion", "la reclasificacion es el motivo que manda");

  // Un `id` duplicado en cualquiera de los dos lados invalida la comparacion
  // entera, y se dice de que lado.
  assert.equal(compararObligacion([critica("a"), critica("a")], [critica("a")]).lado, "base");
  assert.equal(compararObligacion([critica("a")], [critica("a"), critica("a")]).lado, "head");
}

// --- 5. lo que se exporta y nadie probaba -------------------------------
assert.deepEqual([...POLITICAS_HUMAN_GATE], ["attestation", "declarative", "none"]);
assert.equal(auditSurfaceIdentity([limpia("a"), limpia("b")]).ok, true);
assert.equal(auditSurfaceIdentity([limpia("a"), limpia("a")]).code, "authz-contract-duplicate-surface-id");
assert.equal(auditSurfaceIdentity([{ path: "src" }]).code, "authz-contract-surface-id-missing");
assert.equal(auditSurfaceIdentity([{ ...limpia("a"), id: "   " }]).code, "authz-contract-surface-id-missing", "un id en blanco no es identidad");
assert.equal(auditSurfaceIdentity("no soy una lista").code, "authz-contract-surfaces-invalid");

// --- 6. debilitar la POLITICA es un downgrade (D7) -----------------------
// `compararObligacion` mira solo `surfaces`, asi que esto vive aparte: bajar
// la politica no mueve ningun `required` y nadie lo reportaba.
{
  const con = (policy, overrides) => ({ surfaces: [limpia("a")], governance: { humanGate: { policy, overrides } } });
  assert.equal(compararPolitica(con("attestation"), con("declarative")).length, 1, "attestation -> declarative es debilitar");
  assert.equal(compararPolitica(con("declarative"), con("none")).length, 1, "declarative -> none es debilitar");
  assert.equal(compararPolitica(con("declarative"), con("attestation")).length, 0, "endurecer no es downgrade");
  assert.equal(compararPolitica(con("attestation"), con("attestation")).length, 0);
  // Y por FASE, que es donde vive el override.
  const porFase = compararPolitica(con("attestation"), con("attestation", { F13: "declarative" }), ["F13"]);
  assert.equal(porFase.length, 1);
  assert.equal(porFase[0].phaseId, "F13");
}


// --- sin clasificar no es clasificada con riesgos (fix 2.0.1) -------------
// Encontrado adoptando 2.0.0 en un consumidor real: un contrato plenamente
// clasificado con riesgos true producia el mismo hallazgo que uno sin tocar,
// y el remedio que el hallazgo dictaba ya estaba hecho.
{
  const clasificada = [
    { id: 'a', money_path: true, regulated_data: false, security_critical: false, state_machine_critical: false },
    { id: 'b', money_path: false, regulated_data: false, security_critical: true, state_machine_critical: false }
  ];
  assert.deepEqual(superficiesSinClasificar(clasificada), [], 'clasificadas con riesgos no son sin clasificar');

  const incompleta = [
    { id: 'a', money_path: true, regulated_data: false }, // faltan dos riesgos
    { id: 'b', money_path: false, regulated_data: false, security_critical: false, state_machine_critical: false }
  ];
  assert.deepEqual(superficiesSinClasificar(incompleta), ['a'], 'solo la que tiene riesgos no booleanos');

  const conCadena = [{ id: 'x', money_path: 'si', regulated_data: false, security_critical: false, state_machine_critical: false }];
  assert.deepEqual(superficiesSinClasificar(conCadena), ['x'], 'una cadena no es una clasificacion');

  assert.deepEqual(superficiesSinClasificar(undefined), []);
  assert.deepEqual(superficiesSinClasificar([null, 'hola']), ['(sin id)', '(sin id)']);
}

console.log("authz: PASS");
