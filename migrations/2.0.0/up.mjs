// 2.0.0 — hallazgos de operar el framework en manga-translator-mvp.
//
// La migracion es la minima posible a proposito: NO reescribe `surfaces` ni
// `stack` del consumidor. Que el instalador dejara de escribir placeholders es
// un cambio para instalaciones NUEVAS; a un repo ya configurado no se le tocan
// sus superficies desde una migracion automatica, porque son justamente el dato
// del que dependen sus gates y su firma.
//
// Lo que sí cambia de comportamiento tras actualizar, y por eso va escrito en
// el archivo que queda en `.sdlc/migrations/`:
//
//   1. Las atestaciones emitidas antes de 2.0.0 NO verifican: el sujeto de la
//      firma cambio de formato (object id de git por blob, en vez de sha256 del
//      contenido del working tree). Hay que volver a firmar con
//      `sdlc signoff --slice <id> --phase <F> --create --record`.
//      SIN `--record` se crea el commit firmado pero NO se toca la evidencia,
//      asi que el gate sigue bloqueando y parece que no funciono. Es el mismo
//      defecto que 2.0.0 arregla, y esta nota lo repetia.
//   2. `doctor` empieza a reportar `config-surfaces-empty` y
//      `config-stack-placeholder` como ERROR. Un consumidor que conserve
//      `apps/api`/`apps/web` o `<BACKEND_STACK>` de la plantilla los vera desde
//      la primera corrida: es la condicion que hacia vacuos sus gates.
export function up(files = {}) {
  const extra = {
    ".sdlc/migrations/2.0.0-applied.txt": [
      "Migration 2.0.0 applied by SistemaMultiagente_SDLC.",
      "",
      "BREAKING 1: las atestaciones firmadas antes de 2.0.0 no verifican.",
      "  El sujeto de la firma se computa ahora sobre el arbol de git en el commit",
      "  firmado, no sobre el working tree. Volver a firmar:",
      "    sdlc signoff --slice <id> --phase <F> --create --record",
      "  SIN --record se crea el commit firmado pero NO se enlaza con la",
      "  evidencia de la fase, y el gate sigue bloqueando.",
      "",
      "BREAKING 2: doctor reporta como ERROR las superficies vacias y los",
      "  placeholders de stack (config-surfaces-empty, config-stack-placeholder).",
      "  Declarar las superficies reales en .sdlc/config.json y regenerar",
      "  quality-contract.yaml con `sdlc upgrade`.",
      "",
      "BREAKING 3: .github/agents/surface-traceability.json cambia de forma",
      "  (`tier` en lugar de `repoSurface`) y se genera desde config.surfaces.",
      "  Nada del framework lo lee; revisarlo solo si se consume a mano.",
      "",
      "BREAKING 4: el hash de arbol pasa a tener un tope de 64 MiB por llamada",
      "  (antes 256 MiB). Un repo cuyo `git ls-tree -r -z` supere ese tamaño",
      "  empezara a devolver `tree-ref-unreadable` en signoff y en el phase-gate,",
      "  donde antes funcionaba. Son ~715 000 archivos en un solo arbol, asi que",
      "  no alcanza a un repo normal, pero para un monorepo grande el cambio es",
      "  silencioso. Subirlo con SDLC_TREE_HASH_MAX_BUFFER_BYTES (la leen LAS DOS",
      "  vias, sincrona y asincrona); subirlo reduce la concurrencia, no el techo",
      "  de memoria.",
      "",
      "BREAKING 5: TODA excepcion de spec-boundary-allowlist.yaml deja de",
      "  autorizar hasta completarse. Antes el guard leia solo `path` y los otros",
      "  tres campos eran decorativos; ahora se comprueban los cuatro:",
      "    - approved_by        debe ser el `signer` de alguien en",
      "                         governance.maintainers de .sdlc/config.json",
      "    - attestation_commit debe existir, verificar con `git verify-commit`",
      "                         y estar firmado por un mantenedor",
      "    - expires_at         fecha ISO futura",
      "  Una entrada incompleta ya no bloquea en silencio: el guard nombra que",
      "  campo falla. Reparar cada entrada y re-firmar con",
      "    sdlc signoff --slice <id> --phase <F> --create --record",
      "  usando el sha resultante como attestation_commit.",
      "",
      "BREAKING 6: el guard exige una rama base REMOTA calificada",
      "  (refs/remotes/origin/<rama>). Un CI que pasaba `--base origin/<rama>`",
      "  sigue funcionando, pero un tag o una rama LOCAL con ese mismo nombre ya",
      "  no sirve como base: bloquea. Era un secuestro real de la base entera.",
      "",
      "BREAKING 7: el step de frontera del workflow ya no cae a la copia del",
      "  checkout cuando la rama de integracion no trae el guard. Falla con",
      "  `spec-boundary-guard-ausente-en-base`. Instalar el guard y mergearlo a la",
      "  rama de integracion ANTES de abrir PRs.",
      "",
      "BREAKING 8: el alcance del guard crece y puede bloquear lo que antes",
      "  pasaba. (a) vitest.config, stryker.conf, .dependency-cruiser y",
      "  eslint.config se protegen por NOMBRE a cualquier profundidad, no solo en",
      "  la raiz -- un workspace con config por paquete queda cubierto. (b) `**`",
      "  en .sdlc/locked-paths.txt ahora cruza barras de verdad; antes no casaba",
      "  nada. (c) el guard, su config y su allowlist se protegen por SUFIJO de",
      "  ruta, asi que tambien bajo otra raiz. (d) un patron con mas de 8",
      "  comodines se rechaza y se reporta.",
      "generated-by-sdlc",
      ""
    ].join("\n")
  };

  const configPath = ".sdlc/config.json";
  if (typeof files[configPath] === "string") {
    const config = JSON.parse(files[configPath]);
    config.frameworkVersion = "2.0.0";
    extra[configPath] = `${JSON.stringify(config, null, 2)}\n`;
  }

  return extra;
}
