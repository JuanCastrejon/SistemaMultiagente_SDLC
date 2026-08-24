// ---------------------------------------------------------------------------
// `--if-present` es una bandera del gestor de paquetes, no un argumento del
// script.
//
// EL DEFECTO. La rama pnpm construia `pnpm run <script> --if-present`. Con el
// flag DETRAS del nombre, pnpm deja de leerlo como suyo y se lo reenvia al
// script. En un consumidor real, `validate:openspec` es
// `openspec validate --all`, asi que recibia `--all "--if-present"` y moria con
// `error: unknown option '--if-present'`.
//
// `sdlc verdict` contaba ese fallo como BLOCKING y devolvia **NOT-READY sobre
// un repo con los 18 validadores en verde**. Lo caro no es el falso rojo: es
// que un veredicto equivocado se lee como problema del repo evaluado, no de
// quien lo invoca — y manda a buscar donde no hay nada.
//
// La rama npm ya lo ponia delante. El test compara las dos formas para que no
// vuelvan a divergir: es el tipo de asimetria que nadie mira dos veces.
// ---------------------------------------------------------------------------
import assert from "node:assert/strict";

import { detectPackageManager, PACKAGE_MANAGERS } from "../src/harness.js";

const script = "validate:openspec";

for (const clave of ["pnpm", "npm"]) {
  const gestor = PACKAGE_MANAGERS[clave];
  assert.ok(gestor, `falta el gestor ${clave}`);
  const [, args] = gestor.runScript(script);
  const posFlag = args.indexOf("--if-present");
  const posScript = args.indexOf(script);

  assert.ok(posFlag >= 0, `${clave}: se perdio --if-present`);
  assert.ok(posScript >= 0, `${clave}: se perdio el nombre del script`);
  assert.ok(
    posFlag < posScript,
    `${clave}: \`--if-present\` va ANTES del script; detras se lo come el script como argumento (${args.join(" ")})`
  );
}

console.log("run-script: --if-present es bandera del gestor, no del script: PASS");

// Y lo que NO puede pasar: que un argumento del gestor termine pegado a los del
// script. Se comprueba sobre la forma completa, no solo sobre el orden.
{
  const [, args] = PACKAGE_MANAGERS.pnpm.runScript(script);
  assert.deepEqual(
    args,
    ["pnpm", "run", "--if-present", script],
    `la invocacion de pnpm cambio de forma: ${args.join(" ")}`
  );
}

console.log("run-script: forma exacta de la invocacion pnpm: PASS");

// `detectPackageManager` tiene que seguir devolviendo un gestor con `runScript`
// utilizable: si esa forma cambia, los llamadores (verdict, status, quality)
// fallan de maneras que no se parecen a esta causa.
{
  const gestor = detectPackageManager(process.cwd());
  assert.equal(typeof gestor.runScript, "function", "el gestor detectado no expone runScript");
  const [comando, args] = gestor.runScript(script);
  assert.equal(typeof comando, "string");
  assert.ok(Array.isArray(args) && args.includes(script));
}

console.log("run-script: el gestor detectado conserva el contrato: PASS");
