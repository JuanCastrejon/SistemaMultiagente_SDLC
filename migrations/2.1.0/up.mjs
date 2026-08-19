// 2.1.0 — la spec de fases del framework pasa de
// `openspec/specs/project-phases/spec.md` a `openspec/specs/sdlc-phases/spec.md`,
// y la ruta anterior SALE del set gestionado.
//
// Por que: lo que esa spec canoniza son las fases del PROCESO (F0-F17), iguales
// en todo repo que instale el framework. El nombre `project-phases` invita a la
// lectura contraria —"las fases de mi proyecto"— y un consumidor real escribio
// ahi 273 lineas de hoja de ruta de producto (F0 Gobierno ... F7 Cierre). Como
// la ruta era gestionada, el upgrade defectuoso de 2.0.2 la sobreescribio con la
// plantilla de 62 lineas y el repo perdio su plan de trabajo.
//
// ALCANCE EXACTO: esa perdida silenciosa ya no es posible desde 2.0.3 — hoy el
// mismo upgrade BLOQUEA con `status: conflict`. Lo que 2.1.0 corrige no es la
// perdida sino su causa: mientras el framework sea dueño de una ruta cuyo
// nombre promete lo contrario, el consumidor arrastra conflicto y override
// permanentes por un archivo que nunca fue del framework, y `F1` sigue
// significando dos cosas distintas en el mismo repo.
//
// QUE NO HACE ESTA MIGRACION: no borra nada. El contrato de `up` solo permite
// devolver archivos a escribir, nunca a eliminar, y aqui eso es una ventaja, no
// una limitacion. Lo que el consumidor tenga en
// `openspec/specs/project-phases/spec.md` se queda exactamente como esta; el
// framework simplemente deja de escribir ahi para siempre. Un consumidor que
// tenga su hoja de ruta en esa ruta la conserva y pasa a ser dueño unico; uno
// que tenga la plantilla del framework se queda con una copia huerfana que
// puede borrar cuando quiera.
//
// Lo que si cambia de comportamiento tras actualizar:
//
//   1. `doctor` deja de exigir `openspec/specs/project-phases/spec.md`
//      (`openspec-canonical-missing`) y pasa a exigir
//      `openspec/specs/sdlc-phases/spec.md`, que este mismo upgrade escribe.
//   2. Aparece el hallazgo `managed-file-override-orphan` para overrides cuyo
//      path ya no gestiona el framework. Un consumidor con un override
//      declarado sobre `openspec/specs/project-phases/spec.md` lo vera: es
//      correcto, la ruta ya es suya y el registro del framework sobra.
//   3. La plantilla de `.github/agent-state/phase-status.yaml` lista
//      `openspec/specs/sdlc-phases/` en `canonical_specs`. Un consumidor con
//      override sobre ese archivo conserva su version y debe actualizar la
//      entrada a mano si le importa — el campo es declarativo, ningun validador
//      lo lee.
export function up(files = {}, context = {}) {
  const OLD_PATH = "openspec/specs/project-phases/spec.md";
  const NEW_PATH = "openspec/specs/sdlc-phases/spec.md";

  const readDisk = typeof context.readDisk === "function" ? context.readDisk : () => null;
  const existing = readDisk(OLD_PATH);
  const plantillaNueva = files[NEW_PATH] ?? null;

  // Se distingue el caso "lo que hay en la ruta vieja es la plantilla del
  // framework" del caso "el consumidor puso ahi contenido propio", porque el
  // consejo que hay que darle es distinto y darle el equivocado es como se
  // pierden archivos.
  let estado;
  if (existing === null) {
    estado = "ausente";
  } else if (plantillaNueva !== null && existing.trim() === plantillaNueva.trim()) {
    estado = "copia-del-framework";
  } else {
    estado = "contenido-propio";
  }

  const consejo = {
    ausente: [
      "No habia nada en la ruta anterior. Nada que decidir.",
      "`openspec/specs/project-phases/` queda libre por si este repo quiere",
      "escribir ahi su propia hoja de ruta de producto: el framework ya no la toca."
    ],
    "copia-del-framework": [
      "La ruta anterior contiene la plantilla del framework, no contenido propio.",
      "Se puede borrar cuando se quiera:",
      "    git rm -r openspec/specs/project-phases/",
      "ATENCION: si este repo tenia ahi una hoja de ruta propia ANTES de adoptar el",
      "framework, lo que hay hoy es el resultado de haberla sobreescrito. Comprobarlo",
      "en el historial antes de borrar:",
      "    git log --oneline -- openspec/specs/project-phases/spec.md",
      "    git show <commit-anterior>:openspec/specs/project-phases/spec.md"
    ],
    "contenido-propio": [
      "La ruta anterior tiene contenido que NO es la plantilla del framework.",
      "Se conserva intacta y a partir de ahora este repo es su unico dueño:",
      "ningun install ni upgrade volvera a escribir en",
      "`openspec/specs/project-phases/`.",
      "Si ese contenido son las fases del PROCESO y no del producto, moverlo a",
      "`openspec/specs/sdlc-phases/` y borrar la ruta vieja."
    ]
  }[estado];

  return {
    ".sdlc/migrations/2.1.0-applied.txt": [
      "Migration 2.1.0 applied by SistemaMultiagente_SDLC.",
      "",
      "CAMBIO: la spec de fases del framework se renombra",
      `  ${OLD_PATH}`,
      `  -> ${NEW_PATH}`,
      "y la ruta anterior SALE del set de archivos gestionados.",
      "",
      "MOTIVO: la spec canoniza las fases del PROCESO (F0-F17), iguales en todo",
      "  repo que instale el framework. El nombre `project-phases` invitaba a",
      "  leerla como las fases del proyecto y a escribir ahi una hoja de ruta de",
      "  producto, que el siguiente upgrade sobreescribia. Al salir del set",
      "  gestionado, esa ruta ya no puede ser sobreescrita por el framework.",
      "",
      "NO SE BORRO NADA. Una migracion solo puede escribir archivos, nunca",
      "  eliminarlos. El contenido de la ruta anterior sigue en disco tal cual.",
      "",
      `ESTADO DETECTADO EN ESTE REPO: ${estado}`,
      ...consejo.map((linea) => `  ${linea}`),
      "",
      "TAMBIEN CAMBIA:",
      "  - `doctor` deja de exigir la ruta vieja (openspec-canonical-missing) y",
      "    exige la nueva, que este upgrade acaba de escribir.",
      "  - Nuevo hallazgo `managed-file-override-orphan`: un override declarado",
      "    sobre un path que el framework ya no gestiona. Si este repo tenia un",
      "    override sobre la ruta vieja, lo vera. Es correcto: la ruta ya es suya.",
      "  - La plantilla de .github/agent-state/phase-status.yaml lista",
      "    `openspec/specs/sdlc-phases/` en canonical_specs. Con override sobre",
      "    ese archivo hay que actualizarlo a mano; el campo es declarativo.",
      ""
    ].join("\n")
  };
}
