// 2.0.3 es solo el fix de `detectConflicts`/`commandUpgrade` (un override
// aceptado dejaba de estar protegido en el siguiente `upgrade` no
// relacionado, y un archivo gestionado borrado a proposito reaparecia solo):
// no toca ningun archivo del consumidor. Migracion vacia por la misma razon
// que 2.0.1/2.0.2 — el registro de versiones es la lista de destinos
// soportados por `upgrade`; sin entrada, un consumidor en 2.0.3 no podria
// volver a correr `upgrade`.
export async function up() {
  return { writes: [] };
}
