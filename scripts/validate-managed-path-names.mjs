// ---------------------------------------------------------------------------
// Ninguna ruta gestionada NUEVA puede ocupar un nombre generico del consumidor.
//
// La causa raiz del clobber de `00b92ce` no fue un fallo de copia: fue que el
// motor ocupaba `openspec/specs/project-phases/spec.md` para su taxonomia
// F0-F17. El consumidor tenia su propio modelo de fases —F0-F7, los modulos de
// su producto— y escribio 273 lineas ahi. Dos duenos, una ruta.
//
// 2.1.0 lo arreglo renombrando a `sdlc-phases/`. Este validador es lo que hace
// que la regla SOBREVIVA al caso concreto: sin el, el arreglo protege a
// `project-phases` y deja la puerta abierta para el siguiente nombre generico.
//
// LA REGLA. Un `target` bajo un espacio que el consumidor tambien usa —la raiz
// del repo y `openspec/specs/`, ver ESPACIOS_COMPARTIDOS— tiene que estar en
// una de estas tres situaciones:
//
//   1. namespaced por el motor  -> `sdlc-*`, `.sdlc/`, `.github/agent-state/`
//   2. declarado `seed_only`    -> se escribe una vez y despues es del host,
//                                  asi que la colision deja de poder pisar nada
//   3. exento con razon escrita -> la lista de abajo
//
// El apartado 2 no es una escapatoria: es la resolucion correcta para los
// ficheros que el consumidor va a querer suyos de todas formas.
// ---------------------------------------------------------------------------
import { loadManifest } from "../src/template-loader.js";

// Los DOS espacios donde una colision de nombres puede destruir contenido del
// consumidor. Deliberadamente estrecho.
//
// La primera version de este validador cubria tambien `docs/`, `scripts/` y
// `openspec/schemas/`, y marco ~50 ficheros legitimos del motor. Eso es
// exactamente el fallo que la version 2.2.0 acaba de corregir en `doctor`: un
// control cuyas alertas nadie puede cerrar enseña a ignorar el control. Cubrir
// mas no es proteger mas.
//
// Para `docs/` y `scripts/` la proteccion correcta NO es estatica: una colision
// ahi solo existe contra un consumidor concreto, y quien la ve es
// `detectConflicts` con `UNMANAGED_EXISTING` —"archivo preexistente no
// gestionado"— que bloquea el install antes de escribir. Ese camino ya funciona.
//
// Aqui se cubre lo que esa deteccion NO alcanza a tiempo: el espacio de
// capacidades canonicas, donde el motor reclama un sustantivo del dominio, y la
// raiz, donde reclama el nombre que cualquier repo usa para sus propias reglas.
const ESPACIOS_COMPARTIDOS = [
  { prefijo: "openspec/specs/", motivo: "capacidades canonicas del consumidor: aqui ocurrio el clobber de 00b92ce" },
  { prefijo: "", motivo: "raiz del repo: aqui viven las reglas propias del consumidor" }
];

const NAMESPACED = /(^|\/)(sdlc[-_.]|\.sdlc\/)/;

// Exenciones, cada una con su razon. Añadir una entrada aqui es declarar que se
// acepta el riesgo de colision para esa ruta, no un tramite.
const EXENTOS = new Map([
  ["quality-contract.yaml", "contrato del motor citado por nombre en ADR 0008 y en los workflows; renombrarlo rompe a todos los consumidores instalados"],
  ["phase-contract.yaml", "idem: lleva `human_gate`, que es el AND exterior del modelo de autorizacion"],
  ["openspec/specs/.gitkeep", "marcador de directorio, sin contenido que colisionar"],
  ["openspec/specs/business-production-readiness/spec.md", "RIESGO ACEPTADO: es exactamente la forma de `project-phases`. Un consumidor con su propia capacidad de readiness de negocio colisionaria. Renombrar a `sdlc-business-readiness` exige migracion de los consumidores ya instalados; queda como deuda declarada, no como descuido"],
  ["openspec/specs/business-production-readiness/README.md", "idem"]
]);

const manifest = loadManifest();
const errores = [];
let revisadas = 0;

for (const entrada of manifest.templates) {
  const target = entrada.target;
  const espacio = ESPACIOS_COMPARTIDOS.find((e) =>
    e.prefijo === "" ? !target.includes("/") : target.startsWith(e.prefijo)
  );
  if (!espacio) continue;
  revisadas += 1;
  if (entrada.seed_only === true) continue;
  if (NAMESPACED.test(target)) continue;
  if (EXENTOS.has(target)) continue;
  errores.push(`${target} — ${espacio.motivo}`);
}

if (errores.length > 0) {
  console.error("Managed path names validation: FAIL");
  for (const error of errores) console.error(`- ${error}`);
  console.error("\nUna ruta gestionada en un espacio del consumidor necesita UNA de tres:");
  console.error("  1. nombre namespaced por el motor (`sdlc-*`, `.sdlc/`)");
  console.error("  2. `seed_only: true` en templates/manifest.yaml — se escribe una vez y es del host");
  console.error("  3. entrada en EXENTOS de este script, CON la razon escrita");
  console.error("\nLa causa raiz del clobber de 00b92ce fue exactamente esto: dos duenos, una ruta.");
  process.exit(1);
}

console.log(`Managed path names validation: PASS (${revisadas} rutas en espacios compartidos, ${EXENTOS.size} exenciones declaradas)`);
