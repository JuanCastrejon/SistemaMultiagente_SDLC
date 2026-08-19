// 2.0.6 corrige `doctor`: el override de `.sdlc/overrides.yaml` se consulta
// antes de comparar contra la plantilla, asi que un override ya pisado se
// reporta como `managed-file-override-stale` en vez de no producir ningun
// hallazgo, y una eliminacion aceptada (`deleted: true`) deja de reportarse
// como `managed-file-missing`. Es un cambio de DIAGNOSTICO: no escribe ni
// reescribe ningun archivo gestionado del consumidor.
//
// Un repo que arrastre overrides pisados desde 2.0.2 vera aparecer avisos
// `managed-file-override-stale` que antes no salian. Eso es el fix
// funcionando, no una regresion: cada aviso senala un archivo cuya version
// local aceptada ya no esta en disco. La decision de restaurarlo o de
// re-aceptar el estado actual es del consumidor, no de la migracion — por eso
// aqui no se toca nada.
//
// Migracion vacia por la misma razon que 2.0.1/2.0.2/2.0.3/2.0.4/2.0.5 — el
// registro de versiones es la lista de destinos soportados por `upgrade`; sin
// entrada, un consumidor no podria apuntar a esta version.
export async function up() {
  return { writes: [] };
}
