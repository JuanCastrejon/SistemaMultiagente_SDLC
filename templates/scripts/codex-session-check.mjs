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
// Salidas: 0 sesion utilizable · 2 accion requerida (sin sesion, token vencido,
// plan sin cuota util) · 1 error al leer.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EXIT_OK = 0;
const EXIT_ERROR = 1;
const EXIT_ACTION_REQUIRED = 2;

const json = process.argv.includes("--json");

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

// Los planes sin cuota util para una sesion de trabajo. `free` es el que
// rompio la ronda de debate: responde a las primeras llamadas y corta a mitad
// de turno, que es peor que negarse desde el principio.
const PLANS_SIN_CUOTA = new Set(["free", "unknown", ""]);

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

  if (expired) {
    return {
      status: "action-required",
      code: "codex-session-expired",
      detail: `la sesion de ${email ?? "(cuenta desconocida)"} vencio el ${session.expiresAt}. Renovar con \`codex login\` antes de delegar.`,
      session
    };
  }

  if (PLANS_SIN_CUOTA.has(String(plan ?? "").toLowerCase())) {
    return {
      status: "action-required",
      code: "codex-plan-sin-cuota",
      detail:
        `la cuenta activa es ${email ?? "(desconocida)"} con plan '${plan ?? "desconocido"}'. ` +
        "Un turno largo puede cortarse a mitad y perderse el trabajo del turno. " +
        "Verificar que esta es la cuenta que se pretende usar; si no lo es, `codex login` con la correcta.",
      session
    };
  }

  return { status: "ok", code: null, detail: `sesion activa: ${email} (plan ${plan})`, session };
}

const result = inspect();

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
  if (result.status !== "ok") console.log(`  accion      : ${result.detail}`);
}

process.exit(result.status === "ok" ? EXIT_OK : result.status === "error" ? EXIT_ERROR : EXIT_ACTION_REQUIRED);
