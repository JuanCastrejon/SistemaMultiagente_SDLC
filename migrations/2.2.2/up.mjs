// 2.2.2: `tools-doctor` deja de tener su lista de sondas hardcodeada y sondea
// tambien lo que declara `external-tools.yaml`.
//
// Medido en un consumidor: el inventario declaraba 12 herramientas y el doctor
// reportaba 9. `gh`, `codex` y `skillopt` no salian NUNCA — ni ok, ni warning,
// ni missing. Estaban declaradas y eran invisibles. La cabecera del propio
// inventario afirmaba que el doctor lo lee; era cierto solo a medias.
//
// Cambio de LECTURA, no de estado: no toca ningun fichero gestionado. Migracion
// vacia por la misma razon que las anteriores.
export async function up() {
  return { writes: [] };
}
