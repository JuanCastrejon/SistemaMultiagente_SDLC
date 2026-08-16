// 2.0.2 es solo el fix de `doctor` (skill-mirror-without-canonical no
// consultaba el manifiesto para externas/cross-mirror): no toca ningun
// archivo del consumidor. Migracion vacia por la misma razon que 2.0.1 —
// el registro de versiones es la lista de destinos soportados por `upgrade`.
export async function up() {
  return { writes: [] };
}
