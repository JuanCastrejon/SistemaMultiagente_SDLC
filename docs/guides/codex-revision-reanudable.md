# Revisión adversarial con Codex, sin perder trabajo por cuota

## El problema, medido

La ronda 8 de revisión murió a mitad: la cuenta agotó su cuota. Codex ya había
hecho el trabajo —**775 KB de sesión, 352 eventos, 246 items de respuesta**—
pero como los hallazgos vivían en su cabeza esperando el mensaje final, el
resultado utilizable fue **cero**.

No fue un problema del canal. Ya invocamos `codex exec` directo por CLI (el
puente del plugin se cuelga). El problema es **dónde vive el trabajo mientras
se hace**.

## Lo que sí sobrevive por defecto

Codex persiste cada conversación en `$CODEX_HOME/sessions/<año>/<mes>/<día>/`
como un `rollout-*.jsonl`. **La sesión de la ronda 8 está intacta.** Verificado:

```bash
codex exec resume 01a000df-8336-74a1-8b9e-f3b7bc035cce --skip-git-repo-check "di solo OK"
```

…carga la sesión y reporta sus 194 177 tokens de contexto. Solo la cuota la
detiene. **Nada del razonamiento se perdió.**

## Las tres contenciones

En orden de importancia. La primera es la única que no depende de reanudar nada.

### 1. Hallazgos incrementales (la que de verdad importa)

El prompt obliga a Codex a **anexar cada hallazgo a un archivo en cuanto lo
confirma**, con `>>`, nunca `>`. Si la cuota muere, se pierde como mucho el
hallazgo en vuelo — no la ronda entera.

Se anexan también líneas `## PROGRESO:` y `## SIN HALLAZGOS EN: <área>`, porque
saber que un área ya se revisó y salió limpia vale tanto como un hallazgo: evita
que quien reanude repita el trabajo.

`scripts/codex-review.mjs` antepone ese contrato automáticamente.

### 2. Sesión reanudable

El runner captura el `session id` **en cuanto aparece en la salida** y escribe
`REANUDAR.md` con el comando exacto. Se escribe en ese momento, no al terminar:
si el proceso muere de golpe, ese archivo es lo único que permite continuar.

### 3. Salida a disco

`--output-last-message` manda la respuesta final a un archivo, y el log de
eventos se anexa en vivo. Nada depende de que alguien esté mirando la consola.

## Uso

```bash
# Ronda nueva
node scripts/codex-review.mjs docs/prompts/ronda-9.md .codex-out/ronda-9

# Continuar una que murió (misma cuenta)
node scripts/codex-review.mjs --resume <session-id> .codex-out/ronda-9
```

## Continuar con OTRA cuenta

La sesión es un archivo **local**; la cuota es del **servidor**. Por eso se puede
mover.

La forma limpia de tener varias cuentas en paralelo es `CODEX_HOME`: cada valor
es un directorio con su propio `auth.json` y sus propias sesiones.

```bash
# 1. crear el hogar de la segunda cuenta (una sola vez)
CODEX_HOME=~/.codex-b codex login

# 2. copiar la sesión muerta a ese hogar, conservando la ruta relativa
find ~/.codex/sessions -name "*<session-id>*"
mkdir -p ~/.codex-b/sessions/2026/08/14
cp ~/.codex/sessions/2026/08/14/rollout-*<session-id>*.jsonl ~/.codex-b/sessions/2026/08/14/

# 3. reanudar desde ahí
CODEX_HOME=~/.codex-b node scripts/codex-review.mjs --resume <session-id> .codex-out/ronda-9
```

**Lo que cuesta:** reanudar reenvía la conversación, así que la cuenta nueva paga
ese contexto de entrada (en la ronda 8, ~194 k tokens). **Lo que se ahorra:** no
se repite el razonamiento ni las ejecuciones ya hechas.

## La regla que se saca de todo esto

Partir la revisión en bloques pequeños con entregable escrito **es mejor que una
ronda grande**, aunque la ronda grande suene más completa. Una ronda de una hora
que muere al minuto 55 vale cero; seis bloques de diez minutos que mueren en el
quinto valen cuatro sextos.

## Estado de las cuentas

Verificado el 2026-08-14: la cuenta en uso agotó su cuota, con reset anunciado
para el **13-sep-2026**. Para cerrar la ronda 8 hace falta otra cuenta, o esperar.
