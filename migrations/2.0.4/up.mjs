// 2.0.4 es solo el fix de `quality-gate` (una fase sin `quality_gates`
// declarado heredaba los gates de F8/F9/F10 y quedaba bloqueada): no toca
// ningun archivo del consumidor. Migracion vacia por la misma razon que
// 2.0.1/2.0.2/2.0.3 — el registro de versiones es la lista de destinos
// soportados por `upgrade`; sin entrada, un consumidor no podria apuntar a
// esta version.
export async function up() {
  return { writes: [] };
}
