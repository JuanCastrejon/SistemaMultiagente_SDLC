#!/usr/bin/env node
// El import va DENTRO del try a proposito. Con `import` estatico, un fallo al
// evaluar cualquier modulo del arbol -- por ejemplo un
// `SDLC_TREE_HASH_MAX_BUFFER_BYTES` invalido, que se valida al cargar
// `file-utils.js` -- ocurre ANTES de que `main()` exista, asi que su manejador
// de errores no llega a correr: el usuario recibia un stack crudo de Node y,
// con `--json`, un stdout VACIO. Una automatizacion que espera el contrato de
// error del CLI se quedaba sin nada que leer. Lo encontro la ronda 10 de
// revision adversarial.
try {
  const { main } = await import("../src/cli.js");
  await main(process.argv.slice(2));
} catch (error) {
  // Se replica el mismo contrato que usa `main`: payload JSON por stdout cuando
  // se pidio `--json`, mensaje plano si no. `--json` se detecta a mano porque
  // el parser del CLI vive en el modulo que acaba de fallar.
  const json = process.argv.includes("--json");
  const payload = {
    status: "error",
    message: error.message,
    stack: process.env.SDLC_DEBUG ? error.stack : undefined
  };
  if (json) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  } else {
    console.error(payload.message);
  }
  process.exitCode = 1;
}
