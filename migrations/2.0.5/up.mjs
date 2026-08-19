// 2.0.5 agrega el flag `--touched-paths` a `sdlc phase-gate` y hace que
// `resolveArtifact` resuelva `openspec/changes/<slice>/...` via
// `active-slices.yaml.openspec_change` en vez de sustituir el slice ID
// literal como nombre de carpeta. Ninguno de los dos cambios toca archivos
// gestionados del consumidor -- el consumidor decide por su cuenta si
// declara `openspec_change`/`touches_locked`/`touches_proposed` en su propio
// `active-slices.yaml` y si pasa `--touched-paths` desde su CI. Migracion
// vacia por la misma razon que 2.0.1/2.0.2/2.0.3/2.0.4 — el registro de
// versiones es la lista de destinos soportados por `upgrade`; sin entrada,
// un consumidor no podria apuntar a esta version.
export async function up() {
  return { writes: [] };
}
