#!/usr/bin/env node
/**
 * Lanza una revision adversarial con Codex de forma REANUDABLE.
 *
 * El problema que resuelve, medido: la ronda 8 de revision murio a mitad porque
 * la cuenta agoto su cuota. Codex habia hecho el trabajo -- 775 KB de sesion,
 * 246 items de respuesta -- pero como todo vivia en el proceso y la respuesta
 * final nunca se escribio, el resultado util fue CERO.
 *
 * Tres contenciones, en orden de importancia:
 *
 *  1. HALLAZGOS INCREMENTALES. El prompt obliga a Codex a anexar cada hallazgo
 *     a un archivo EN CUANTO lo confirma, en vez de acumularlos para el final.
 *     Si la cuota muere, se pierde como mucho el hallazgo en vuelo. Esta es la
 *     unica contencion que no depende de reanudar nada.
 *  2. SESION PERSISTIDA. Codex guarda la conversacion entera en
 *     `$CODEX_HOME/sessions/`. Este script captura el id y deja escrito el
 *     comando exacto para reanudar, incluso si el proceso muere.
 *  3. SALIDA A DISCO. `--output-last-message` y el log de eventos van a
 *     archivos, no solo a stdout.
 *
 * Uso:
 *   node scripts/codex-review.mjs <prompt.md> <directorio-salida>
 *   node scripts/codex-review.mjs --resume <session-id> <directorio-salida> [prompt]
 *
 * Para continuar con OTRA cuenta ver `docs/guides/codex-revision-reanudable.md`.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ---------------------------------------------------------------------------
// PREFLIGHT: cuatro modos, no dos.
//
// El runner trataba "funciona" y "no funciona" como los dos unicos estados, y
// por eso una cuota agotada parecia un fallo del runner. Peor: se construia el
// prompt entero y se lanzaba el proceso para descubrir en la salida algo que se
// sabia ANTES de gastar nada.
//
// La idea es de gstack (https://github.com/garrytan/gstack), cuyo
// `codexPreflight` distingue disabled / not_installed / not_authed / ready y
// obliga a declarar la politica de caida para cada uno. Aqui se añade un quinto
// —`quota`— porque es el que mas veces ha pasado en este repo, y se recuerda en
// disco: si la cuota se agoto hace diez minutos y se libera dentro de un mes,
// volver a lanzar solo sirve para perder otro minuto.
//
// La propiedad que importa: la revision cruzada es INFORMATIVA, nunca un gate.
// Que Codex no este disponible no bloquea nada — cambia quien hace de segunda
// voz, y eso se declara.
// ---------------------------------------------------------------------------
const MODOS = {
  DESHABILITADO: "disabled",
  NO_INSTALADO: "not_installed",
  SIN_AUTENTICAR: "not_authed",
  SIN_CUOTA: "quota",
  LISTO: "ready"
};

function rutaCooldown() {
  return path.join(".codex-out", "cooldown.json");
}

function leerCooldown() {
  try {
    const datos = JSON.parse(fs.readFileSync(rutaCooldown(), "utf8"));
    const hasta = Date.parse(datos.hasta);
    if (!Number.isFinite(hasta) || hasta <= Date.now()) return null;
    return { hasta: datos.hasta, cuenta: datos.cuenta ?? "(desconocida)" };
  } catch {
    return null;
  }
}

function escribirCooldown(hasta) {
  try {
    fs.mkdirSync(".codex-out", { recursive: true });
    fs.writeFileSync(
      rutaCooldown(),
      JSON.stringify({ hasta, cuenta: process.env.CODEX_HOME ?? "~/.codex", anotado: new Date().toISOString() }, null, 2),
      "utf8"
    );
  } catch {
    /* anotar el cooldown es una comodidad, nunca un motivo para fallar */
  }
}

function preflight() {
  if (process.env.SDLC_CODEX_REVIEWS === "disabled") return { modo: MODOS.DESHABILITADO };

  const enfriando = leerCooldown();
  if (enfriando) return { modo: MODOS.SIN_CUOTA, detalle: `hasta ${enfriando.hasta} (cuenta ${enfriando.cuenta})` };

  // `shell: true` solo por el shim `.cmd` de Windows; no viaja ningun dato del
  // prompt por aqui.
  const opciones = { encoding: "utf8", shell: process.platform === "win32", timeout: 30_000 };
  const version = spawnSync("codex", ["--version"], opciones);
  if (version.error || version.status !== 0) return { modo: MODOS.NO_INSTALADO };

  const login = spawnSync("codex", ["login", "status"], opciones);
  if (login.error || login.status !== 0) return { modo: MODOS.SIN_AUTENTICAR };

  return { modo: MODOS.LISTO, detalle: (version.stdout ?? "").trim() };
}

function explicarModo({ modo, detalle }) {
  const caida =
    "Cae al `adversario` local (.claude/agents/adversario.md). Es segunda voz, pero\n" +
    "  del MISMO modelo que la primera: sus puntos ciegos estan correlados. Declaralo\n" +
    "  en el informe.";
  switch (modo) {
    case MODOS.DESHABILITADO:
      return "Revisiones cruzadas apagadas (SDLC_CODEX_REVIEWS=disabled).\n  Apagado significa apagado: no se cae a un subagente local.";
    case MODOS.NO_INSTALADO:
      return `Codex CLI no esta en el PATH.\n  Instalar: npm install -g @openai/codex\n  ${caida}`;
    case MODOS.SIN_AUTENTICAR:
      return `Codex instalado pero sin credenciales.\n  Autenticar: codex login   (o CODEX_HOME=~/.codex-b codex login para otra cuenta)\n  ${caida}`;
    case MODOS.SIN_CUOTA:
      return `Cuota agotada ${detalle}.\n  Cambiar de cuenta: CODEX_HOME=~/.codex-b codex login\n  Borrar el recordatorio si crees que ya se libero: rm ${rutaCooldown()}\n  ${caida}`;
    default:
      return `Codex listo${detalle ? ` (${detalle})` : ""}.`;
  }
}

const args = process.argv.slice(2);
const esResume = args[0] === "--resume";

if (args.length < 2) {
  console.error("Uso: node scripts/codex-review.mjs <prompt.md> <dir-salida>");
  console.error("     node scripts/codex-review.mjs --resume <session-id> <dir-salida> [prompt]");
  process.exit(2);
}

const dirSalida = esResume ? args[2] : args[1];
if (!dirSalida) {
  console.error("Falta el directorio de salida.");
  process.exit(2);
}
fs.mkdirSync(dirSalida, { recursive: true });

const rutaHallazgos = path.join(dirSalida, "hallazgos.md");
const rutaFinal = path.join(dirSalida, "respuesta-final.md");
const rutaEventos = path.join(dirSalida, "eventos.jsonl");
const rutaSesion = path.join(dirSalida, "sesion.txt");
const rutaReanudar = path.join(dirSalida, "REANUDAR.md");

// Se comprueba ANTES de construir el prompt y de escribir nada: lanzar para
// descubrir en la salida algo que se sabia de antemano cuesta un minuto y, si
// el prompt ya se escribio, deja el directorio de la ronda a medias.
if (process.env.SDLC_CODEX_SKIP_PREFLIGHT !== "1") {
  const estado = preflight();
  console.log(`CODEX_MODE: ${estado.modo}`);
  if (estado.modo !== MODOS.LISTO) {
    console.error(`\n${explicarModo(estado)}\n`);
    // 3 = "no se pudo correr la revision cruzada, y no es un fallo del trabajo".
    // Distinto del 2 de cuota-agotada-a-media-revision, donde SI hay hallazgos
    // en disco y una sesion que reanudar.
    process.exit(3);
  }
  console.log(explicarModo(estado));
}

// El contrato de escritura incremental. Se antepone al prompt del usuario
// porque es lo que hace que una muerte por cuota no cueste el trabajo entero.
const CONTRATO = `# CONTRATO DE ESTA REVISION -- leelo antes que nada

Tu cuota puede agotarse EN MEDIO de este trabajo. Ya paso: una ronda anterior
murio con 775 KB de razonamiento hecho y entrego CERO hallazgos utiles, porque
los estaba guardando para el mensaje final.

Por eso, en esta revision:

**ANEXA CADA HALLAZGO A \`${rutaHallazgos.replace(/\\/g, "/")}\` EN CUANTO LO
CONFIRMES.** No esperes al final. No acumules. Un hallazgo confirmado que sigue
solo en tu cabeza es un hallazgo perdido.

Usa \`>>\` (anexar), nunca \`>\` (sobrescribir). Formato por hallazgo:

\`\`\`
[BLOQUEANTE|SERIO|MENOR] archivo:linea — titulo en una linea
  Como se rompe: <secuencia concreta; si lo ejecutaste, la salida real>
  Por que importa aqui: <consecuencia en signoff/phase-gate>
  Correccion sugerida: <una o dos lineas>
  Verificado: <ejecutado | solo razonado>
\`\`\`

Anexa tambien, a medida que avanzas:

- una linea \`## PROGRESO: <que acabas de terminar>\` al cerrar cada bloque, para
  que quien reanude sepa donde te quedaste;
- \`## SIN HALLAZGOS EN: <area>\` cuando termines un area limpia. Saber que algo
  ya se reviso y salio limpio vale tanto como un hallazgo.

Al final, ademas, entrega el resumen completo como respuesta normal.

---

`;

let comando;
// El prompt SIEMPRE viaja por stdin, nunca como argumento. Dos motivos, y el
// segundo es de seguridad:
//  - en Windows hace falta `shell: true` para lanzar el shim `codex.cmd`
//    (Node bloquea ejecutar .cmd sin shell), y meter un prompt de miles de
//    caracteres con comillas, backticks y saltos de linea en una linea de shell
//    es una via de inyeccion evidente;
//  - `codex exec -` lee de stdin justamente para esto.
let promptPorStdin;

if (esResume) {
  const sessionId = args[1];
  promptPorStdin =
    args[3] ??
    "Continua exactamente donde te quedaste. Antes de nada, LEE el archivo de hallazgos que ya escribiste para no repetir trabajo ni volver a reportar lo mismo.";
  comando = ["exec", "resume", sessionId, "--skip-git-repo-check", "-o", rutaFinal, "-"];
  console.log(`Reanudando sesion ${sessionId}`);
} else {
  const rutaPrompt = args[0];
  if (!fs.existsSync(rutaPrompt)) {
    console.error(`No existe el prompt: ${rutaPrompt}`);
    process.exit(2);
  }
  promptPorStdin = CONTRATO + fs.readFileSync(rutaPrompt, "utf8");
  fs.writeFileSync(path.join(dirSalida, "prompt-enviado.md"), promptPorStdin, "utf8");
  fs.writeFileSync(rutaHallazgos, `# Hallazgos (se anexan en vivo)\n\nPrompt: ${rutaPrompt}\n\n`, "utf8");
  comando = ["exec", "--skip-git-repo-check", "-c", 'model_reasoning_effort="xhigh"', "-o", rutaFinal, "-"];
}

const hijo = spawn("codex", comando, {
  stdio: ["pipe", "pipe", "pipe"],
  // Ver arriba: solo por el shim `.cmd`. Ningun dato del prompt llega al shell.
  shell: process.platform === "win32"
});

// Sin este listener, un fallo al lanzar (ENOENT del shim, PATH recortado) llega
// ASINCRONO: el proceso muere volcando el objeto de error y `close` no dispara,
// asi que el runner terminaba en 0 sin haber revisado nada. Fue exactamente lo
// que paso en el primer intento de la ronda 9.
hijo.on("error", (error) => {
  console.error(`\nNo se pudo lanzar codex: ${error.message}`);
  console.error(`Comprueba que \`codex\` esta en PATH (\`codex --version\`).`);
  process.exit(1);
});

hijo.stdin.on("error", () => {
  /* si el hijo murio antes de leer, el 'error' de arriba ya lo reporta */
});
hijo.stdin.end(promptPorStdin, "utf8");

const logEventos = fs.createWriteStream(rutaEventos, { flags: "a" });

let sessionId = esResume ? args[1] : null;
let buffer = "";

// Deteccion explicita de cuota. Sin esto, agotar el limite se veia igual que
// cualquier otro fallo -- "codigo distinto de 0" -- y habia que ir a leer el
// log para entender que solo hacia falta cambiar de cuenta. Paso dos veces
// (rondas 8 y 9).
let cuotaAgotada = false;
const PATRON_CUOTA = /usage limit|hit your usage limit|quota|rate limit|try again at/i;

// Deteccion de cuelgue. En la ronda 9, Codex entrego su veredicto completo y el
// proceso siguio vivo 39 MINUTOS sin escribir nada: el trabajo estaba hecho y
// nadie se enteraba. Se avisa por inactividad, no se mata -- una revision larga
// puede tardar en pensar, y matarla seria peor que esperarla.
const INACTIVIDAD_MS = Number(process.env.SDLC_CODEX_IDLE_WARN_MS ?? 5 * 60 * 1000);
let ultimaSalida = Date.now();
let avisadoDeCuelgue = false;
const vigilanteInactividad = setInterval(() => {
  const quieto = Date.now() - ultimaSalida;
  if (quieto < INACTIVIDAD_MS || avisadoDeCuelgue) return;
  avisadoDeCuelgue = true;
  const hallazgos = fs.existsSync(rutaHallazgos) ? fs.readFileSync(rutaHallazgos, "utf8") : "";
  const n = (hallazgos.match(/^\[(BLOQUEANTE|SERIO|MENOR)\]/gm) ?? []).length;
  console.warn(`\n${"!".repeat(60)}`);
  console.warn(`AVISO: codex lleva ${Math.round(quieto / 60000)} min sin escribir nada.`);
  console.warn(`Puede haber terminado y quedarse colgado (paso en la ronda 9).`);
  console.warn(`Hallazgos ya anexados: ${n} -> ${rutaHallazgos}`);
  console.warn(`Si el veredicto ya esta en el log, se puede cerrar el proceso sin perder nada.`);
  console.warn(`${"!".repeat(60)}\n`);
}, 30_000);
vigilanteInactividad.unref?.();

const mirar = (texto) => {
  logEventos.write(texto);
  ultimaSalida = Date.now();
  if (!cuotaAgotada && PATRON_CUOTA.test(texto)) {
    cuotaAgotada = true;
    // El propio mensaje trae la fecha de liberacion ("try again at Sep 12th,
    // 2026 3:58 PM"). Se anota para que el preflight de la proxima corrida no
    // gaste otro lanzamiento en descubrir lo mismo.
    const m = texto.match(/try again at ([^.\n]+)/i);
    const cuando = m ? Date.parse(m[1].replace(/(\d+)(st|nd|rd|th)/, "$1")) : NaN;
    escribirCooldown(Number.isFinite(cuando) ? new Date(cuando).toISOString() : new Date(Date.now() + 3600_000).toISOString());
  }
  if (sessionId) return;
  buffer += texto;
  const m = buffer.match(/session id:\s*([0-9a-f-]{36})/i);
  if (m) {
    sessionId = m[1];
    fs.writeFileSync(rutaSesion, sessionId, "utf8");
    // Se escribe YA, no al terminar: si el proceso muere de golpe, esto es lo
    // unico que permite continuar sin repetir el trabajo.
    fs.writeFileSync(
      rutaReanudar,
      [
        "# Como continuar esta revision",
        "",
        `Sesion: \`${sessionId}\``,
        "",
        "## Con la misma cuenta",
        "",
        "```bash",
        `node scripts/codex-review.mjs --resume ${sessionId} ${dirSalida.replace(/\\/g, "/")}`,
        "```",
        "",
        "## Con OTRA cuenta (cuota agotada)",
        "",
        "La sesion es un archivo local; la cuota es del servidor. Copiar la sesion",
        "al `CODEX_HOME` de la otra cuenta y reanudar ahi:",
        "",
        "```bash",
        "# 1. localizar el archivo de sesion",
        `find ~/.codex/sessions -name "*${sessionId}*"`,
        "",
        "# 2. copiarlo al CODEX_HOME de la otra cuenta (misma ruta relativa)",
        "#    (crear antes ese CODEX_HOME con: CODEX_HOME=~/.codex-b codex login)",
        "",
        "# 3. reanudar desde ahi",
        `CODEX_HOME=~/.codex-b node scripts/codex-review.mjs --resume ${sessionId} ${dirSalida.replace(/\\/g, "/")}`,
        "```",
        "",
        "Reanudar reenvia la conversacion, asi que consume tokens de la cuenta nueva,",
        "pero NO repite el trabajo: Codex conserva lo que ya razono y ejecuto.",
        "",
        `Los hallazgos ya confirmados estan en \`${rutaHallazgos.replace(/\\/g, "/")}\``,
        "y sobreviven aunque no se reanude nada."
      ].join("\n"),
      "utf8"
    );
    console.log(`\n>> sesion ${sessionId} — comando de reanudacion en ${rutaReanudar}\n`);
  }
};

hijo.stdout.on("data", (c) => { const t = c.toString("utf8"); process.stdout.write(t); mirar(t); });
hijo.stderr.on("data", (c) => { const t = c.toString("utf8"); process.stderr.write(t); mirar(t); });

hijo.on("close", (code) => {
  clearInterval(vigilanteInactividad);
  logEventos.end();
  const hallazgos = fs.existsSync(rutaHallazgos) ? fs.readFileSync(rutaHallazgos, "utf8") : "";
  const n = (hallazgos.match(/^\[(BLOQUEANTE|SERIO|MENOR)\]/gm) ?? []).length;
  const porGravedad = (nivel) => (hallazgos.match(new RegExp(`^\\[${nivel}\\]`, "gm")) ?? []).length;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`codex termino con codigo ${code}`);
  console.log(
    `hallazgos anexados en vivo: ${n}` +
      (n > 0 ? ` (${porGravedad("BLOQUEANTE")} bloqueantes, ${porGravedad("SERIO")} serios, ${porGravedad("MENOR")} menores)` : "") +
      `  ->  ${rutaHallazgos}`
  );

  if (cuotaAgotada) {
    // El caso que ya costo dos rondas: no es un fallo del trabajo, es
    // administrativo. Se dice con todas las letras y con el comando delante.
    console.log(`\n${"*".repeat(60)}`);
    console.log(`CUOTA AGOTADA -- hay que CAMBIAR DE CUENTA para continuar.`);
    console.log(`${"*".repeat(60)}`);
    console.log(`\nNo se perdio nada: los ${n} hallazgos ya estan en disco y la sesion`);
    console.log(`entera esta guardada. Al reanudar, codex conserva lo que ya razono`);
    console.log(`y ejecuto -- no repite el trabajo.\n`);
    console.log(`  1. inicia sesion con la otra cuenta:`);
    console.log(`       codex login`);
    if (sessionId) {
      console.log(`\n  2. reanuda exactamente donde se quedo:`);
      console.log(`       node scripts/codex-review.mjs --resume ${sessionId} ${dirSalida.replace(/\\/g, "/")}`);
    }
    console.log(`\n  (detalle completo en ${rutaReanudar})\n`);
  } else if (code !== 0) {
    console.log(`\nNO se completo. El trabajo NO se perdio:`);
    console.log(`  - hallazgos confirmados: ${rutaHallazgos}`);
    if (sessionId) console.log(`  - como continuar:        ${rutaReanudar}`);
  }

  // La cuota no es un fallo de la revision: se distingue del resto (2) para que
  // quien automatice esto pueda reintentar con otra cuenta sin confundirlo con
  // un hallazgo o un error real.
  process.exit(cuotaAgotada ? 2 : code ?? 1);
});
