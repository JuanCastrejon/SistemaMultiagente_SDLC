// 2.2.1 corrige la posicion de `--if-present` en la invocacion de pnpm.
//
// La rama pnpm construia `pnpm run <script> --if-present`. Detras del nombre,
// pnpm deja de leerlo como bandera suya y se lo pasa AL SCRIPT. En un consumidor
// real `validate:openspec` es `openspec validate --all`, asi que recibia
// `--all "--if-present"` y moria con `unknown option`. `sdlc verdict` contaba
// ese fallo como BLOCKING y devolvia NOT-READY sobre un repo con todos sus
// validadores en verde.
//
// Es un cambio de INVOCACION: no toca ningun fichero gestionado ni pide nada al
// consumidor. Migracion vacia por la misma razon que 2.0.1-2.2.0: el registro de
// versiones es la lista de destinos que `upgrade` acepta.
export async function up() {
  return { writes: [] };
}
