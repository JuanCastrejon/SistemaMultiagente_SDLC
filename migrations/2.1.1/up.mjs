// 2.1.1 arregla la salida humana del CLI: `print` solo sabia renderizar
// `message` e `items`, y los payloads que devuelven datos estructurados no
// traen ninguno de los dos. Sin `--json` esos comandos salian MUDOS, con el
// exit code correcto pero invisible. El caso caro fue `sdlc signoff --create
// --record`: el gate humano que autoriza cada ruta bloqueada no decia ni que
// firmaba, ni que bloqueaba, ni por que, asi que un bloqueo se leia como
// ejecutado.
//
// Es un cambio de SALIDA, no de estado: no toca ningun archivo gestionado, no
// cambia la forma del `--json` (solo anade `created` a los payloads de
// `signoff`, que es aditivo) y no requiere que el consumidor haga nada. Los
// fallos pasan a escribirse por stderr en vez de stdout cuando NO se pide
// `--json`; toda la automatizacion del framework lee `--json` por stdout y no
// se ve afectada.
//
// Migracion vacia por la misma razon que 2.0.1-2.0.6: el registro de versiones
// es la lista de destinos soportados por `upgrade`; sin entrada, un consumidor
// no podria apuntar a esta version.
export async function up() {
  return { writes: [] };
}
