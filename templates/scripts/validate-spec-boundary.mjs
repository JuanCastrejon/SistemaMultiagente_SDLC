#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Guard de frontera de especificacion (ADR 0007)
//
// El gauntlet entero se apoya en una suposicion: que la especificacion contra
// la que se juzga al agente no la escribe el agente. Sin este guard, la ruta de
// menor resistencia para pasar cualquier gate es reescribir el criterio.
//
// Que hace: compara el diff contra la rama de integracion REMOTA y falla si
// toca rutas protegidas sin que exista una excepcion declarada, VERIFICADA y
// vigente.
//
// Que NO hace: no sustituye la atestacion firmada de la fase
// (`sdlc signoff --slice <id> --phase <F> --create --record`). Este script
// decide por RUTA; la atestacion decide por AUTORIZACION. Desde 2.0.0 el guard
// exige que cada excepcion apunte a una atestacion firmada real, asi que las
// dos mitades se tocan — pero siguen siendo dos.
//
// NO es un review de plataforma: con un solo maintainer GitHub prohibe
// auto-aprobar el PR propio, asi que esa via es insatisfacible. Ver el addendum
// del ADR 0007 y el ADR 0008.
//
// Sin dependencias fuera de node: este archivo se ejecuta desde una copia
// traida con `git show` a un temporal, donde no hay `node_modules` que resolver.
// ---------------------------------------------------------------------------

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const DEFAULT_LOCKED = [
  "openspec/specs/",
  "openspec/changes/*/specs/",
  "openspec/changes/*/acceptance/",
  "quality-contract.yaml",
  "phase-contract.yaml",
  ".github/agent-state/quality-baseline.yaml",
  // El ledger de lecciones lo escribe el propio evaluado y guarda sus errores.
  // Sin protegerlo, borrar el historial de las piedras con las que uno tropezo
  // es un `rm` que nadie ve — la memoria institucional que el ADR 025 pide se
  // evapora justo cuando conviene que exista.
  ".github/agent-state/lessons.yaml",
  ".github/workflows/"
];

// Configuracion de gates que define el UMBRAL con el que se juzga al evaluado.
// Van por BASENAME y a cualquier profundidad, no por prefijo de raiz: la
// topologia normal de un consumidor es un workspace con la config de cobertura
// y de mutacion POR PAQUETE. Anclarlas a la raiz dejaba `packages/app/
// vitest.config.ts` fuera del guard, y bajar ahi `thresholds` es reescribir el
// criterio igual que hacerlo en la raiz. Reproducido en la ronda 16.
//
// Los DOS CONTRATOS van tambien por basename, y por un motivo distinto del de
// las configs de gate: un consumidor instalado con
// `sdlc adopt --target apps/extension` tiene su `quality-contract.yaml` en
// `apps/extension/`, y el patron anclado a la raiz no lo alcanzaba. El ADR 0008
// elige poner la politica de autorizacion en `quality-contract.yaml`
// argumentando que "ya esta protegido" — y ese argumento solo era cierto para
// instalaciones en la raiz del repo git. `phase-contract.yaml` es peor todavia:
// lleva `human_gate`, que es el AND exterior de todo el modelo.
const LOCKED_BASENAME_PREFIXES = [
  "vitest.config",
  "stryker.conf",
  ".dependency-cruiser",
  "eslint.config",
  "quality-contract.yaml",
  "phase-contract.yaml"
];

// Rutas que el guard protege SIEMPRE, sin importar que diga locked-paths.txt
// ni ningun otro archivo de configuracion. Sin esto, la ruta mas barata para
// desactivar el guard entero no es tocar una ruta protegida (eso se detecta):
// es reescribir el script del guard, vaciar su propia lista de rutas
// protegidas, o agregarse a mano a su propia allowlist.
//
// Van por SUFIJO de ruta, no por prefijo. Con `startsWith`, el prefijo
// `templates/` sacaba del alcance la FUENTE del guard de todos los consumidores
// —quien trabaja en el framework podia vaciar `DEFAULT_LOCKED` sin dejar
// rastro— y tampoco cubria a un consumidor que instalara bajo otra raiz.
const ALWAYS_LOCKED_SUFFIXES = [
  "scripts/validate-spec-boundary.mjs",
  ".sdlc/locked-paths.txt",
  ".sdlc/config.json",
  ".github/agent-state/spec-boundary-allowlist.yaml"
];

// Tope de comodines por patron. `locked-paths.txt` lo escribe el evaluado, y un
// patron como `*a*a*a…*b` contra una ruta larga tarda MINUTOS en resolverse por
// backtracking. Medido en la ronda 16: 15 comodines, sin terminar en 90 s. No
// es evasion —el job muere en rojo— pero es una negacion de servicio del propio
// control, autoinfligible y baratisima. El matcher de abajo ya es lineal, y
// este tope es el cinturon del tirante.
const MAX_COMODINES = 8;

const RUTA_ALLOWLIST = ".github/agent-state/spec-boundary-allowlist.yaml";

function parseArgs(argv) {
  const options = { base: null, lockedFile: ".sdlc/locked-paths.txt", allowlist: RUTA_ALLOWLIST, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--json") options.json = true;
    else if (token === "--base") options.base = argv[++index];
    else if (token === "--locked") options.lockedFile = argv[++index];
    else if (token === "--allowlist") options.allowlist = argv[++index];
  }
  return options;
}

// Tres decisiones de esta funcion, todas por hallazgos reproducidos:
//
// 1. `maxBuffer` amplio: el default de Node es 1 MiB y `execFileSync` lanza
//    ENOBUFS al superarlo. Con un catch tragandose el error, un PR grande
//    dejaba el diff en CERO rutas y el guard seguia como si nada.
// 2. El fallo se DEVUELVE, no se traga: quien llama decide. Para los diffs, no
//    poder medir no puede parecerse a no tener nada que reportar.
// 3. Sin `allowFailure`, un error es un error. `resolveBase` si lo usa, porque
//    ahi probar refs que no existen es el modo normal de operar.
//
// Ya NO se pasa `core.quotePath=false`: tapaba solo el no-ASCII y daba la
// sensacion de que la clase entera estaba cerrada. Ver `gitRutas`.
function git(args, { allowFailure = false } = {}) {
  try {
    // stderr en `pipe`, no heredado: probar refs y rutas que no existen es el
    // modo NORMAL de operar de este guard (`readFromBase` de un archivo ausente
    // en la base, `resolveBase` recorriendo candidatos). Con el default de
    // `execFileSync`, cada intento fallido escupia un `fatal:` en la salida del
    // job y hacia parecer roto lo que funciona.
    const stdout = execFileSync("git", args, {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "pipe"]
    });
    return { ok: true, stdout, error: null };
  } catch (error) {
    return { ok: allowFailure, stdout: "", error };
  }
}

function gitText(args) {
  return git(args, { allowFailure: true }).stdout.trim();
}

// ─── Firmas SSH verificables en cualquier entorno ──────────────────────────
//
// `verify-commit` de una firma SSH exige `gpg.ssh.allowedSignersFile`, y esa
// config vive en el ENTORNO del que corre el guard: en un runner de CI no
// existe, y toda entrada del allowlist moria con "no verifica como commit
// firmado" — descubierto en el primer PR que necesito validar una excepcion de
// verdad (2026-08-16): local en verde, CI en rojo con `allowed: []`.
//
// El repo puede llevar su propio `.sdlc/allowed_signers` con las claves
// PUBLICAS de sus maintainers — no es secreto, es el material que hay que
// distribuir. Leerlo del checkout es seguro porque lo que se verifica NO lo
// elige el checkout: el `attestation_commit` viene fijado por la allowlist de
// la BASE y los maintainers tambien. Cambiar este archivo solo puede NEGAR
// validaciones a entradas legitimas, nunca fabricarlas: la firma del commit
// fijado tiene que casar con la clave listada para ese principal.
const SIGNERS_CFG = (() => {
  if (!fs.existsSync(".sdlc/allowed_signers")) return [];
  const ruta = `${process.cwd().replaceAll("\\", "/")}/.sdlc/allowed_signers`;
  return ["-c", `gpg.ssh.allowedSignersFile=${ruta}`];
})();

// Rutas SIEMPRE por salida NUL-delimitada.
//
// `core.quotePath=false` gobierna unicamente los bytes >= 0x80. git aplica
// C-quoting SIEMPRE para `"`, `\` y los caracteres de control, que en POSIX son
// nombres de archivo legales. Una ruta entrecomillada no casa ningun patron
// —la comilla inicial rompe el prefijo— asi que un archivo NUEVO bajo un arbol
// protegido con uno de esos tres caracteres era invisible al guard.
// Reproducido en la ronda 16 con `git mktree` + `commit-tree`.
//
// Con `-z` git no entrecomilla NUNCA: emite los bytes crudos y separa por NUL.
function gitRutas(args) {
  const resultado = git([...args, "-z"]);
  if (!resultado.ok) return resultado;
  return { ok: true, rutas: resultado.stdout.split("\0").filter(Boolean), error: null };
}

// ─── Base: siempre una ref REMOTA calificada ───────────────────────────────
//
// `rev-parse origin/develop` usa el nombre CORTO, y las reglas DWIM de
// gitrevisions prueban `refs/tags/<n>` y `refs/heads/<n>` ANTES que
// `refs/remotes/<n>`. Un tag —o una rama local— llamado literalmente
// `origin/develop` apuntando al HEAD del atacante secuestraba la base entera:
// el guard comparaba HEAD contra HEAD, obtenia diff vacio, y ademas el
// `git show "$BASE:..."` del workflow traia la copia "confiable" del arbol del
// atacante. git avisa de la ambiguedad solo por stderr, que nadie leia.
//
// Se resuelve el nombre COMPLETO y ademas se exige que lo resuelto viva bajo
// `refs/remotes/`: una comprobacion no depende de la otra.
function calificarRemota(candidato) {
  if (!candidato) return null;
  const completa = candidato.startsWith("refs/") ? candidato : `refs/remotes/${candidato}`;
  if (!completa.startsWith("refs/remotes/")) return null;
  if (!gitText(["rev-parse", "--verify", "--quiet", completa])) return null;
  const simbolica = gitText(["rev-parse", "--symbolic-full-name", completa]);
  if (!simbolica.startsWith("refs/remotes/")) return null;
  return simbolica;
}

function resolveBase(explicit) {
  const candidatos = [
    explicit,
    process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null,
    "origin/develop",
    "origin/main"
  ].filter(Boolean);
  for (const candidato of candidatos) {
    const calificada = calificarRemota(candidato);
    if (calificada) return calificada;
  }
  return null;
}

// ─── Patrones ──────────────────────────────────────────────────────────────

function normalizarRuta(valor) {
  return valor.replace(/\\/g, "/").replace(/^\.\//, "");
}

// Casa un SEGMENTO (sin `/`) contra un patron de segmento con `*`. Iterativo
// con un solo punto de retroceso: O(n*m) en el peor caso, nunca exponencial.
function casaSegmento(texto, patron, permitirPrefijo) {
  let i = 0;
  let j = 0;
  let estrella = -1;
  let marca = 0;
  while (i < texto.length) {
    if (j < patron.length && (patron[j] === texto[i] || patron[j] === "?")) {
      i += 1;
      j += 1;
    } else if (j < patron.length && patron[j] === "*") {
      estrella = j;
      marca = i;
      j += 1;
    } else if (estrella !== -1) {
      j = estrella + 1;
      marca += 1;
      i = marca;
    } else {
      return false;
    }
    // Prefijo agotado antes que el texto: solo vale si el patron es prefijo.
    if (j === patron.length && i < texto.length && permitirPrefijo && estrella === -1) return true;
  }
  while (j < patron.length && patron[j] === "*") j += 1;
  return j === patron.length;
}

// Casa una ruta contra un patron con semantica de PREFIJO por segmentos.
// `**` cruza barras; `*` no. Memoizado sobre (i, j): O(n*m), sin explosion.
function casaSegmentos(rutaSegs, patronSegs, terminaEnBarra) {
  const memo = new Map();
  function paso(i, j) {
    const clave = `${i}:${j}`;
    if (memo.has(clave)) return memo.get(clave);
    let salida;
    if (j === patronSegs.length) {
      // Patron agotado: con barra final se exige que haya algo debajo O que la
      // ruta sea exactamente el directorio. Lo segundo cubre el caso del
      // segmento comodin que resulta ser un SYMLINK o un GITLINK: git reporta
      // `openspec/changes/mi/specs` sin barra, y el patron
      // `openspec/changes/*/specs/` no casaba. Mudar el criterio a un symlink
      // sacaba el arbol entero del alcance del guard.
      salida = terminaEnBarra ? i <= rutaSegs.length : true;
    } else if (i >= rutaSegs.length) {
      salida = false;
    } else if (patronSegs[j] === "**") {
      salida = paso(i, j + 1) || paso(i + 1, j);
    } else {
      const ultimo = j === patronSegs.length - 1;
      // El ultimo segmento de un patron SIN barra final casa por prefijo:
      // `vitest.config` protege `vitest.config.ts`.
      const permitirPrefijo = ultimo && !terminaEnBarra;
      salida = casaSegmento(rutaSegs[i], patronSegs[j], permitirPrefijo) && paso(i + 1, j + 1);
    }
    memo.set(clave, salida);
    return salida;
  }
  return paso(0, 0);
}

function matchesPattern(filePath, pattern) {
  const ruta = normalizarRuta(filePath);
  const patron = normalizarRuta(pattern);
  const terminaEnBarra = patron.endsWith("/");
  const patronSegs = (terminaEnBarra ? patron.slice(0, -1) : patron).split("/").filter(Boolean);
  if (patronSegs.length === 0) return false;
  return casaSegmentos(ruta.split("/"), patronSegs, terminaEnBarra);
}

function casaAlgunPatron(filePath, patrones) {
  const ruta = normalizarRuta(filePath);
  const base = ruta.slice(ruta.lastIndexOf("/") + 1);
  const porNombre = LOCKED_BASENAME_PREFIXES.find((prefijo) => base.startsWith(prefijo));
  if (porNombre) return `basename:${porNombre}`;
  const sufijo = ALWAYS_LOCKED_SUFFIXES.find((s) => ruta === s || ruta.endsWith(`/${s}`));
  if (sufijo) return sufijo;
  return patrones.find((candidato) => matchesPattern(filePath, candidato)) ?? null;
}

// `lockedFile` EXTIENDE la proteccion, nunca la reemplaza. Antes, un
// locked-paths.txt custom sustituia DEFAULT_LOCKED entero: un consumidor que
// queria agregar una ruta propia perdia sin darse cuenta la proteccion de
// quality-contract.yaml y el resto. ALWAYS_LOCKED tampoco se puede excluir.
function loadLockedPatterns(lockedFile) {
  const rechazados = [];
  const custom = fs.existsSync(lockedFile)
    ? fs
        .readFileSync(lockedFile, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .filter((line) => {
          const comodines = (line.match(/\*/g) ?? []).length;
          if (comodines > MAX_COMODINES) {
            rechazados.push({ patron: line, motivo: `mas de ${MAX_COMODINES} comodines` });
            return false;
          }
          return true;
        })
    : [];
  return {
    patrones: [...new Set([...ALWAYS_LOCKED_SUFFIXES, ...DEFAULT_LOCKED, ...custom])],
    rechazados
  };
}

// Lee un archivo desde la rama base REMOTA, nunca del checkout. Si no existe
// alli (o `git show` falla por cualquier motivo), devuelve null: quien llama
// debe interpretarlo como "sin contenido", nunca caer al checkout.
function readFromBase(base, filePath) {
  const result = git(["show", `${base}:${filePath}`], { allowFailure: true });
  return result.error ? null : result.stdout;
}

// ─── Allowlist ─────────────────────────────────────────────────────────────
//
// Se parsea SIN dependencia de YAML (este archivo corre desde un temporal sin
// node_modules), pero CON nocion de estructura: la version anterior era una
// regex linea-por-linea que aceptaba cualquier `path:` bajo cualquier clave del
// documento. Con `allowlist: []` vacio y un bloque `notas:` con un
// `- path: quality-contract.yaml`, el archivo quedaba autorizado. Reproducido
// en la ronda 16.
//
// Se reconoce el bloque de nivel superior `allowlist:` y solo se leen los items
// de su lista. Lo que no se sabe leer se REPORTA, nunca se ignora en silencio.
function parseAllowlistEntries(raw) {
  if (!raw) return { entradas: [], avisos: [] };
  const entradas = [];
  const avisos = [];
  let dentro = false;
  let actual = null;
  const cerrar = () => {
    if (actual) entradas.push(actual);
    actual = null;
  };
  for (const linea of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(linea) || linea.trim() === "") continue;
    const claveRaiz = linea.match(/^([A-Za-z_][\w-]*)\s*:(.*)$/);
    if (claveRaiz) {
      cerrar();
      dentro = claveRaiz[1] === "allowlist";
      if (dentro && claveRaiz[2].trim() && claveRaiz[2].trim() !== "[]") {
        avisos.push(`allowlist en formato de flujo no soportado: ${claveRaiz[2].trim().slice(0, 60)}`);
      }
      continue;
    }
    if (!dentro) continue;
    const item = linea.match(/^\s*-\s*([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (item) {
      cerrar();
      actual = { [item[1]]: desentrecomillar(item[2]) };
      continue;
    }
    const campo = linea.match(/^\s+([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/);
    if (campo && actual) {
      actual[campo[1]] = desentrecomillar(campo[2]);
      continue;
    }
    avisos.push(`linea no reconocida dentro de allowlist: ${linea.trim().slice(0, 60)}`);
  }
  cerrar();
  return { entradas, avisos };
}

function desentrecomillar(valor) {
  return valor.replace(/^["']|["']$/g, "");
}

// Los mantenedores salen de la BASE, igual que el allowlist: leerlos del
// checkout permitiria al evaluado añadirse a si mismo en el mismo commit.
function loadMaintainers(base) {
  const crudo = readFromBase(base, ".sdlc/config.json");
  if (!crudo) return { firmantes: [], detalle: "no hay .sdlc/config.json en la base" };
  try {
    const config = JSON.parse(crudo);
    const lista = config?.governance?.maintainers ?? [];
    return { firmantes: lista.map((m) => String(m?.signer ?? "").trim()).filter(Boolean), detalle: null };
  } catch (error) {
    return { firmantes: [], detalle: `config de la base ilegible: ${error.message}` };
  }
}

// Una excepcion autoriza SOLO si las cuatro cosas se cumplen. Hasta 2.0.0 el
// guard leia unicamente `path` y los otros tres campos eran decorativos: el
// propio archivo enunciaba tres reglas que nadie comprobaba, que es peor que no
// tener reglas — se creen cumplidas.
function evaluarEntrada(entrada, firmantes, ahora) {
  const problemas = [];
  if (!entrada.path) problemas.push("sin `path`");

  if (!entrada.expires_at) {
    problemas.push("sin `expires_at`: una excepcion sin caducidad se vuelve permanente por olvido");
  } else {
    const vence = Date.parse(entrada.expires_at);
    if (!Number.isFinite(vence)) problemas.push(`\`expires_at\` no es una fecha ISO: ${entrada.expires_at}`);
    else if (vence <= ahora) problemas.push(`excepcion caducada el ${entrada.expires_at}`);
  }

  if (!entrada.approved_by) problemas.push("sin `approved_by`");
  else if (firmantes.length === 0) problemas.push("no hay `governance.maintainers` en la base contra quien cotejar `approved_by`");
  else if (!firmantes.includes(entrada.approved_by))
    problemas.push(`\`approved_by\` no esta en governance.maintainers: ${entrada.approved_by}`);

  if (!entrada.attestation_commit) {
    problemas.push("sin `attestation_commit`");
  } else if (!/^[0-9a-fA-F]{7,64}$/.test(entrada.attestation_commit)) {
    problemas.push(`\`attestation_commit\` no parece un sha: ${entrada.attestation_commit}`);
  } else {
    const existe = git(["cat-file", "-e", `${entrada.attestation_commit}^{commit}`], { allowFailure: true });
    if (existe.error) {
      // Se distingue a proposito de "no vale": un clon superficial no puede ver
      // el commit. Pero NO autoriza — no poder comprobar no es aprobar, que es
      // la misma regla que este guard aplica a su propio diff.
      problemas.push(`\`attestation_commit\` no esta en el historial accesible (¿clon superficial?): ${entrada.attestation_commit}`);
    } else {
      const verificado = git([...SIGNERS_CFG, "verify-commit", entrada.attestation_commit], { allowFailure: true });
      if (verificado.error) {
        problemas.push(`la atestacion ${entrada.attestation_commit.slice(0, 12)} no verifica como commit firmado`);
      } else {
        const firmante = gitText([...SIGNERS_CFG, "log", "-1", "--format=%GS", entrada.attestation_commit]);
        if (firmantes.length > 0 && !firmantes.includes(firmante)) {
          problemas.push(`la atestacion la firma \`${firmante}\`, que no esta en governance.maintainers`);
        }
      }
    }
  }

  return problemas;
}

// El allowlist se lee SIEMPRE de la rama base, NUNCA del checkout evaluado.
//
// Esta asimetria es lo que hace que el guard funcione: `locked-paths.txt` solo
// puede EXTENDER proteccion, asi que leerlo del checkout es inofensivo. El
// allowlist hace lo contrario — EXCLUYE—, y leerlo del checkout permitia el
// ataque de un solo commit: reescribir un archivo protegido y, a la vez, meter
// en el allowlist una entrada que lo autoriza y otra autorreferencial que
// autoriza el propio allowlist. El evaluado se firmaba su permiso.
function loadAllowlist(base, allowlistFile, ahora) {
  const { entradas, avisos } = parseAllowlistEntries(readFromBase(base, allowlistFile));
  const { firmantes, detalle } = loadMaintainers(base);
  if (detalle) avisos.push(detalle);
  const validas = [];
  const rechazadas = [];
  for (const entrada of entradas) {
    const problemas = evaluarEntrada(entrada, firmantes, ahora);
    if (problemas.length === 0) validas.push(entrada.path);
    else rechazadas.push({ path: entrada.path ?? "(sin path)", problemas });
  }
  return { validas, rechazadas, avisos, entradasLeidas: entradas.length };
}

// ─── Ejecucion ─────────────────────────────────────────────────────────────

const options = parseArgs(process.argv.slice(2));
const result = { status: "ok", base: null, locked: [], violations: [], allowed: [] };

// `--allowlist` apuntado a otro archivo de la base convertia cualquier YAML con
// lineas `path:` en una allowlist involuntaria. Solo se acepta la ruta que esta
// en ALWAYS_LOCKED, que es la unica que el guard se protege a si mismo.
if (normalizarRuta(options.allowlist) !== RUTA_ALLOWLIST) {
  result.status = "blocked";
  result.code = "spec-boundary-allowlist-invalida";
  result.detail = `--allowlist solo acepta ${RUTA_ALLOWLIST}: cualquier otro archivo no esta protegido y podria ser escrito por el evaluado`;
  console.log(options.json ? JSON.stringify(result, null, 2) : `spec-boundary: ${result.detail}`);
  process.exit(2);
}

const base = resolveBase(options.base);
result.base = base;

if (!base) {
  // Antes esto era `skipped` con exit 0: verde. El patron "no se pudo medir se
  // ve igual que todo bien" que el ADR 0007 prohibe, en el control que sostiene
  // todos los demas. Un guard que no puede hacer su trabajo bloquea.
  result.status = "blocked";
  result.code = "spec-boundary-base-unresolvable";
  result.detail =
    "no hay rama base REMOTA resoluble bajo refs/remotes/; el guard no puede comparar contra nada verificable. Verificar que el checkout traiga la rama de integracion (fetch-depth: 0) y que gitFlow.integrationBranch coincida con la rama real. Un tag o rama local con nombre `origin/<rama>` NO sirve como base a proposito.";
  console.log(options.json ? JSON.stringify(result, null, 2) : `spec-boundary: ${result.detail}`);
  process.exit(2);
}

const mergeBase = gitText(["merge-base", base, "HEAD"]) || base;
// Commits del branch MAS working tree, staged Y sin trackear: `git diff` por si
// solo es ciego a un archivo nuevo que nunca se agrego al indice.
//
// `--no-renames` NO es cosmetico. Con la deteccion de renames activa,
// `--name-only` imprime SOLO la ruta destino y la ORIGEN desaparece: eso
// permitia sacar cualquier archivo protegido de su ruta sin dejar rastro.
const diffSources = [
  ["diff", "--no-renames", "--name-only", `${mergeBase}...HEAD`],
  ["diff", "--no-renames", "--name-only"],
  ["diff", "--no-renames", "--name-only", "--cached"]
];

const collected = [];
const diffFailures = [];
for (const args of diffSources) {
  const resultado = gitRutas(args);
  if (!resultado.ok) {
    // No poder medir NO puede parecerse a no tener nada que reportar: es la
    // regla de no-vacuidad del ADR 0007 aplicada al propio guard.
    diffFailures.push({ command: `git ${args.join(" ")}`, detail: resultado.error?.message ?? "fallo desconocido" });
    continue;
  }
  collected.push(...resultado.rutas);
}

// Con `-z`, `status --porcelain` emite `XY <ruta>\0`, y un renombrado añade la
// ruta ORIGEN como registro siguiente. Solo interesan los `??`, pero hay que
// saltarse el campo extra de R/C para no leerlo como un registro suelto.
const statusResult = gitRutas(["status", "--porcelain", "--untracked-files=all"]);
if (!statusResult.ok) {
  diffFailures.push({ command: "git status --porcelain", detail: statusResult.error?.message ?? "fallo desconocido" });
} else {
  const registros = statusResult.rutas;
  for (let i = 0; i < registros.length; i += 1) {
    const registro = registros[i];
    const estado = registro.slice(0, 2);
    if (estado[0] === "R" || estado[0] === "C") {
      i += 1; // el siguiente campo es la ruta origen del renombrado
      continue;
    }
    if (estado === "??") collected.push(registro.slice(3));
  }
}

const changed = collected.filter(Boolean).filter((value, index, all) => all.indexOf(value) === index);

const { patrones: lockedPatterns, rechazados: patronesRechazados } = loadLockedPatterns(options.lockedFile);
// `base`, no el checkout: ver el comentario largo en loadAllowlist.
const allowlist = loadAllowlist(base, options.allowlist, Date.now());
result.locked = lockedPatterns;
result.lockedBasenames = LOCKED_BASENAME_PREFIXES;
result.allowlistSource = `${base}:${options.allowlist}`;
result.allowlistEntries = allowlist.entradasLeidas;
if (patronesRechazados.length > 0) result.rejectedPatterns = patronesRechazados;
if (allowlist.rechazadas.length > 0) result.rejectedExceptions = allowlist.rechazadas;
if (allowlist.avisos.length > 0) result.allowlistWarnings = allowlist.avisos;

for (const file of changed) {
  const pattern = casaAlgunPatron(file, lockedPatterns);
  if (!pattern) continue;
  if (allowlist.validas.includes(normalizarRuta(file))) {
    result.allowed.push({ path: file, pattern });
    continue;
  }
  result.violations.push({ path: file, pattern });
}

result.filesCompared = changed.length;
if (diffFailures.length > 0) {
  result.status = "blocked";
  result.diffFailures = diffFailures;
  result.detail = "el guard no pudo enumerar el cambio completo: no se puede afirmar que no toca rutas protegidas";
} else if (result.violations.length > 0) {
  result.status = "blocked";
  result.detail = "el diff toca especificacion o configuracion de gates sin excepcion declarada, vigente y verificada";
}

if (options.json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`spec-boundary contra ${base} (merge-base ${mergeBase.slice(0, 12)})`);
  console.log(`archivos comparados: ${changed.length}`);
  if (result.allowed.length > 0) {
    console.log(`excepciones vigentes: ${result.allowed.map((entry) => entry.path).join(", ")}`);
  }
  for (const rechazada of allowlist.rechazadas) {
    console.log(`excepcion NO valida para ${rechazada.path}: ${rechazada.problemas.join("; ")}`);
  }
  for (const aviso of allowlist.avisos) console.log(`aviso de allowlist: ${aviso}`);
  for (const rechazado of patronesRechazados) console.log(`patron ignorado (${rechazado.motivo}): ${rechazado.patron}`);
  if (result.violations.length > 0) {
    console.log("VIOLACIONES:");
    for (const violation of result.violations) {
      console.log(`  - ${violation.path} (protegido por ${violation.pattern})`);
    }
    console.log("");
    console.log("Si el cambio es legitimo, debe declararse en");
    console.log(`${RUTA_ALLOWLIST} con approved_by de governance.maintainers,`);
    console.log("attestation_commit de una firma real y expires_at vigente.");
  } else {
    console.log("Sin cambios en rutas protegidas.");
  }
}

process.exitCode = result.status === "blocked" ? 2 : 0;
