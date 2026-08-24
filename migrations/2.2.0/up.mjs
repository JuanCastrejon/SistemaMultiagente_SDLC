// 2.2.0 hace accionable `doctor`. Medido en un consumidor con un mes de
// operacion: 161 hallazgos, 81 de ellos `managed-file-override-stale`, y
// `upgrade --dry-run` bloqueando sobre nueve ficheros que el host TIENE que
// editar para operar. Un control cuyas alertas nadie puede cerrar enseña a
// ignorar el control entero. Tras el cambio: 81 hallazgos, 4 stale.
//
// Dos categorias nuevas, y NINGUNA necesita que el consumidor haga nada:
//
//   - `seed_only`: ficheros que el motor escribe al instalar y despues son del
//     host. La categoria se lee del manifiesto de PLANTILLAS que viaja con el
//     motor, no del `install-manifest.json` del consumidor, precisamente para
//     que un repo ya instalado la herede al actualizar sin migrar nada. Esa
//     decision es la que deja esta migracion vacia.
//
//   - mirrors comparados contra su canonica LOCAL en vez de contra la plantilla
//     del motor. Es una regla de lectura de `doctor`; no reescribe ficheros.
//
// El unico efecto sobre el arbol lo produce `upgrade` por su via normal: las
// plantillas de `save`, `resume` y `continua` cambiaron —dejan de ser stubs de
// 18 lineas— asi que un consumidor que las haya editado vera el conflicto que
// `detectConflicts` reporta siempre, y decidira si acepta la version nueva o
// registra un override. Ese camino ya existe y no se corta aqui.
//
// Migracion vacia por la misma razon que 2.0.1-2.1.1: el registro de versiones
// es la lista de destinos soportados por `upgrade`; sin entrada, un consumidor
// no podria apuntar a esta version.
export async function up() {
  return { writes: [] };
}
