#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Preflight de sesion de Codex.
//
// Por que existe: el puente de Codex (ver AGENTS.md) delega trabajo caro a un
// agente externo, y la cuenta con la que corre NO se ve por ningun lado hasta
// que algo falla. Caso reproducido: se cambio de cuenta, la terminal siguio con
// la anterior —plan `free`—, y una ronda de debate murio a mitad de turno con
// "You've hit your usage limit", perdiendo el trabajo del turno y el contexto
// del hilo. El fallo no fue el limite: fue que nadie podia saber contra que
// cuenta estaba hablando.
//
// Que comprueba, todo local y sin red:
//   - que exista sesion (`auth.json`) y en que modo esta autenticado;
//   - CON QUE CUENTA: email y plan, leidos del `id_token`;
//   - si el token ya vencio, que es la otra forma silenciosa de perder un turno.
//
// Que NO hace, y es deliberado: no imprime ni un solo token, ni el
// `account_id` completo. Lee el payload del JWT (la parte publica, sin
// verificar firma: aqui no se autentica a nadie, solo se lee de quien es la
// sesion) y descarta todo lo demas. Tampoco intenta renovar ni cerrar sesion:
// autenticarse es un acto de la persona, no de un script de gobernanza.
//
// Salidas: 0 sesion utilizable (con o sin aviso) · 2 accion requerida (sin
// sesion, o proceso con la credencial vieja) · 1 error al leer.
//
// El plan AVISA pero no bloquea, y la distincion importa: este preflight ve el
// plan, no la cuota que queda. Una cuenta `free` recien estrenada tiene su
// cuota intacta; una `pro` puede estar agotada. Tratar el plan como si fuera
// cuota daba un falso bloqueo -- medido contra una cuenta nueva que si podia
// trabajar -- y un preflight que se equivoca al bloquear es un preflight que se
// aprende a ignorar, que es justo lo que este framework rechaza en sus gates.
// ---------------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

const json = process.argv.includes("--json");
const probe = process.argv.includes("--probe");

// El unico modo de fallo que NINGUNA comprobacion local detecta: la credencial
// esta en disco, sin vencer, y el servidor la rechaza igual porque se inicio
// sesion con otra cuenta desde otro sitio. Medido: `codex login status` decia
// "Logged in using ChatGPT" y salia 0, y la llamada real devolvia "Your access
// token could not be refreshed because you have since logged out or signed in
// to another account".
//
// Por eso `--probe` es OPT-IN y no el comportamiento por defecto: la unica
// forma de saberlo es gastar una llamada de verdad, y un preflight que cobra
// cuota cada vez que alguien lo ejecuta es un preflight que se deja de
// ejecutar. Se usa antes de un turno largo, no antes de cada mensaje.
function probeCredential() {
  // Prompt de UNA palabra a proposito: en Windows `codex` es un `.cmd` y hay
  // que pasar por shell, que parte el argumento en espacios. Una palabra evita
  // el quoting y ademas es la llamada mas barata posible.
  const result = spawnSync("codex", ["exec", "--skip-git-repo-check", "ok"], {
    encoding: "utf8",
    timeout: 90_000,
    shell: process.platform === "win32"
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status === 0) return { ok: true };
  const rechazada = /could not be refreshed|sign in again|logged out|unauthor|401/i.test(output);
  const cuota = /usage limit|rate limit|quota/i.test(output);
  return {
    ok: false,
    code: rechazada ? "codex-session-rechazada" : cuota ? "codex-cuota-agotada" : "codex-probe-fallido",
    detail: output.trim().split("\n").slice(0, 3).join(" ").slice(0, 300)
  };
}

// `CODEX_HOME` manda si esta definido: es lo que usa el propio CLI para mover
// su estado fuera del home, y un preflight que mire otro sitio estaria
// diagnosticando una sesion distinta de la que se va a usar.
function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

function decodeJwtPayload(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length < 2) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

// Planes cuya cuota se agota antes y conviene mirar dos veces antes de un
// turno largo. NO es una lista de planes inservibles: una cuenta `free` recien
// creada trabaja perfectamente hasta agotarse.
const PLANES_CON_CUOTA_CORTA = new Set(["free", "unknown", ""]);

// Tercer modo de fallo, y el mas dificil de ver: un proceso de Codex que
// arranco ANTES del ultimo login sigue con la credencial vieja en memoria. Los
// clientes que hablan con ese demonio —el puente de plugin, por ejemplo—
// fallan con "Your access token could not be refreshed... signed in to another
// account", mientras un `codex exec` recien lanzado funciona perfectamente,
// porque abre proceso propio. Medido: dos procesos de las 15:38 y las 16:43
// contra un `auth.json` reescrito a las 17:18.
//
// Es barato de detectar y no exige red: basta comparar el arranque de cada
// proceso contra la fecha del credencial. Best-effort — si el sistema no deja
// listar procesos, se calla en vez de inventar un diagnostico.
function staleProcesses(authMtimeMs) {
  try {
    if (process.platform === "win32") {
      const ps = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          "Get-Process | Where-Object { $_.ProcessName -match 'codex' } | Select-Object Id,ProcessName,@{n='Start';e={$_.StartTime.ToUniversalTime().ToString('o')}} | ConvertTo-Json -Compress"
        ],
        { encoding: "utf8", timeout: 15_000 }
      );
      if (ps.status !== 0 || !ps.stdout.trim()) return [];
      const parsed = JSON.parse(ps.stdout);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list
        .filter((entry) => entry?.Start && Date.parse(entry.Start) < authMtimeMs)
        .map((entry) => ({ pid: entry.Id, name: entry.ProcessName, startedAt: entry.Start }));
    }
    const ps = spawnSync("ps", ["-eo", "pid,lstart,comm"], { encoding: "utf8", timeout: 15_000 });
    if (ps.status !== 0) return [];
    return ps.stdout
      .split("\n")
      .filter((line) => /codex/i.test(line))
      .map((line) => {
        const match = /^\s*(\d+)\s+(.{24})\s+(.*)$/.exec(line);
        if (!match) return null;
        const started = Date.parse(match[2]);
        return Number.isNaN(started) || started >= authMtimeMs
          ? null
          : { pid: Number(match[1]), name: match[3].trim(), startedAt: new Date(started).toISOString() };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function inspect() {
  const authPath = path.join(codexHome(), "auth.json");
  if (!fs.existsSync(authPath)) {
    return {
      status: "action-required",
      code: "codex-session-missing",
      detail: `no existe ${authPath}: no hay sesion de Codex. Iniciar sesion con \`codex login\` antes de delegar nada.`
    };
  }

  let auth;
  try {
    auth = JSON.parse(fs.readFileSync(authPath, "utf8"));
  } catch (error) {
    return { status: "error", code: "codex-auth-unreadable", detail: `${authPath} no es JSON legible: ${error.message}` };
  }

  const payload = decodeJwtPayload(auth?.tokens?.id_token) ?? {};
  const email = payload.email ?? null;
  const plan = payload["https://api.openai.com/auth"]?.chatgpt_plan_type ?? null;
  const expiresAt = typeof payload.exp === "number" ? new Date(payload.exp * 1000) : null;
  const expired = expiresAt ? expiresAt.getTime() <= Date.now() : null;
  const accountSuffix = auth?.tokens?.account_id ? String(auth.tokens.account_id).slice(-6) : null;

  const session = {
    authMode: auth?.auth_mode ?? null,
    email,
    plan,
    accountIdSuffix: accountSuffix,
    expiresAt: expiresAt ? expiresAt.toISOString() : null,
    expired,
    lastRefresh: auth?.last_refresh ?? null,
    codexHome: codexHome()
  };

  // El token vencido AVISA, no bloquea. El CLI lo refresca solo en la siguiente
  // llamada, sin que nadie tenga que volver a autenticarse: medido en una misma
  // sesion, `exp` paso de 22:57 a 23:18 sin ningun `codex login` de por medio.
  // Tratarlo como bloqueo mandaba al usuario a re-loguear una sesion que estaba
  // perfectamente viva — el segundo falso bloqueo de este mismo script, por la
  // misma causa que el primero: confundir lo que se ve en disco con lo que de
  // verdad ocurre al llamar.
  if (expired) {
    return {
      status: "warning",
      code: "codex-token-vencido",
      detail:
        `el token de ${email ?? "(cuenta desconocida)"} vencio el ${session.expiresAt}; el CLI lo renueva solo en la ` +
        "proxima llamada. Solo si esa llamada falla hace falta `codex login`, y `--probe` lo comprueba sin adivinar.",
      session
    };
  }

  const authMtimeMs = fs.statSync(authPath).mtimeMs;
  const stale = staleProcesses(authMtimeMs);
  if (stale.length > 0) {
    session.staleProcesses = stale;
    return {
      status: "action-required",
      code: "codex-proceso-con-credencial-vieja",
      detail:
        `hay ${stale.length} proceso(s) de Codex arrancados ANTES del ultimo login (${stale
          .map((p) => `${p.name}#${p.pid} ${p.startedAt}`)
          .join(", ")}). Siguen con la credencial anterior en memoria: quien hable con ellos vera un error de token ` +
        "que no se puede refrescar, aunque una llamada nueva funcione. CERRAR Y REABRIR la app de Codex; matar los " +
        "procesos a mano deja al puente sin su sesion compartida y el siguiente trabajo se cuelga sin escribir log.",
      session
    };
  }

  if (PLANES_CON_CUOTA_CORTA.has(String(plan ?? "").toLowerCase())) {
    return {
      status: "warning",
      code: "codex-plan-cuota-corta",
      detail:
        `la cuenta activa es ${email ?? "(desconocida)"} con plan '${plan ?? "desconocido"}'. ` +
        "Este preflight ve el plan, NO la cuota restante: si la cuenta esta estrenada trabaja sin problema, " +
        "y si viene usada un turno largo puede cortarse a mitad. Confirmar que es la cuenta que se pretende " +
        "usar; si no lo es, `codex login` con la correcta.",
      session
    };
  }

  return { status: "ok", code: null, detail: `sesion activa: ${email} (plan ${plan})`, session };
}

const result = inspect();

// El probe solo tiene sentido si la inspeccion local no encontro ya un
// bloqueo: sin sesion, gastar una llamada no aporta nada.
if (probe && result.status !== "action-required" && result.status !== "error") {
  const live = probeCredential();
  result.probe = live;
  if (!live.ok) {
    result.status = "action-required";
    result.code = live.code;
    result.detail =
      live.code === "codex-session-rechazada"
        ? `el servidor rechaza la credencial de ${result.session?.email ?? "esta cuenta"}: se inicio sesion con otra cuenta en otro sitio. Volver a ejecutar \`codex login\`. (${live.detail})`
        : `la llamada de prueba fallo: ${live.detail}`;
  }
}

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  const s = result.session;
  console.log("Codex — sesion activa");
  if (s) {
    console.log(`  cuenta      : ${s.email ?? "(desconocida)"}`);
    console.log(`  plan        : ${s.plan ?? "(desconocido)"}`);
    console.log(`  modo        : ${s.authMode ?? "(desconocido)"}`);
    console.log(`  vence       : ${s.expiresAt ?? "(sin fecha)"}${s.expired ? "  ← VENCIDA" : ""}`);
    console.log(`  account_id  : …${s.accountIdSuffix ?? "??????"}`);
    console.log(`  CODEX_HOME  : ${s.codexHome}`);
  }
  console.log(`  estado      : ${result.status}${result.code ? ` (${result.code})` : ""}`);
  if (result.status !== "ok") console.log(`  ${result.status === "warning" ? "aviso " : "accion"}      : ${result.detail}`);
}

// `warning` sale 0: avisa sin bloquear. Solo la ausencia de sesion y el token
// vencido impiden delegar de verdad.
const exitCode =
  result.status === "error" ? EXIT_ERROR : result.status === "action-required" ? EXIT_ACTION_REQUIRED : EXIT_OK;
process.exit(exitCode);
