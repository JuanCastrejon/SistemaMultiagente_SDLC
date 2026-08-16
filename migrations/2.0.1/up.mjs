// 2.0.1 es solo el fix de la auditoria (clasificada con riesgos != sin
// clasificar): no toca ningun archivo del consumidor. Existe como migracion
// vacia porque el registro de versiones es la lista de destinos soportados por
// `upgrade` — sin entrada, un consumidor en 2.0.1 no podriavolver a correr
// `upgrade` (descubierto por la suite de regresion: "Version no soportada").
export async function up() {
  return { writes: [] };
}
