---
name: codex-sesion
description: "Preflight obligatorio antes de delegar trabajo al puente de Codex: comprueba con que cuenta y con que plan esta autenticada la sesion activa. Usar antes de cualquier `codex` de fondo, debate multi-agente o tarea larga delegada."
---

# Skill: codex-sesion

Comprobar **de quien** es la sesion de Codex antes de delegarle nada.

## Trigger

Antes de la primera delegacion a Codex de cada sesion de trabajo, y de nuevo
despues de cualquier `codex login` o cambio de cuenta.

```bash
node scripts/codex-session-check.mjs
```

`--json` para consumirlo desde otro script. Salidas: `0` sesion utilizable —con
aviso o sin el—, `2` accion requerida (sin sesion o token vencido), `1` error de
lectura.

Lo que este preflight VE es el plan; lo que NO ve es la cuota que queda. Una
cuenta `free` recien estrenada trabaja sin problema y una de pago puede estar
agotada, asi que el plan avisa y nunca bloquea: un preflight que se equivoca al
bloquear es un preflight que se aprende a ignorar.

## Por que existe

El puente de Codex delega trabajo caro a un agente externo, y la cuenta con la
que corre no se ve por ningun lado hasta que algo falla. Caso real: se cambio de
cuenta, la terminal siguio con la anterior —plan `free`— y una ronda de debate
murio a mitad de turno con `You've hit your usage limit`. Se perdio el trabajo
del turno y el hilo quedo sin cerrar. El fallo no fue el limite de cuota: fue
que nadie podia saber contra que cuenta estaba hablando.

## Pasos

1. Ejecutar el preflight. Leer **cuenta** y **plan**, no solo el estado.
2. Si la cuenta no es la que se pretende usar, `codex login` con la correcta.
   Ese comando lo ejecuta una persona: pide credenciales y ningun agente debe
   intentarlo por su cuenta.
3. Si el plan no tiene cuota util para un turno largo, decidir **antes** de
   delegar: o se cambia de cuenta, o se acota el trabajo a algo que sobreviva a
   un corte, o se posterga.
4. Solo entonces delegar.
5. Si un turno se corta igualmente, volver a ejecutar el preflight antes de
   reintentar: el corte pudo cambiar el estado de la sesion.

## Los tres modos de fallo que esto cubre

1. **Sesion de otra cuenta.** La terminal sigue autenticada con la anterior
   aunque creas que cambiaste. Se ve en `cuenta` y en `account_id`.
2. **Credencial rechazada por el servidor.** Esta en disco y sin vencer, pero
   se inicio sesion con otra cuenta desde otro sitio. NO se ve en local:
   `codex login status` responde "Logged in using ChatGPT" y sale `0`. Solo lo
   detecta `--probe`, que gasta una llamada minima.
3. **Proceso con la credencial vieja en memoria.** Un `codex` o un
   `codex-code-mode-host` arrancado ANTES del ultimo login sigue usando la
   credencial anterior. Los clientes que hablan con ese demonio fallan mientras
   una llamada nueva funciona, porque esta abre proceso propio. El preflight lo
   detecta comparando el arranque de cada proceso contra la fecha de
   `auth.json`, y la salida trae el PID. Se resuelve cerrandolos o reiniciando
   la app de Codex.

## Racionalizaciones

- *"Acabo de hacer login, seguro que es la cuenta nueva."* El caso que motivo
  esta skill es exactamente ese. El login ocurrio en otra terminal o en otro
  proceso, y la sesion activa siguio siendo la vieja. Comprobar cuesta un
  segundo; el turno perdido costo una ronda entera de trabajo.
- *"Es una tarea corta, no va a chocar con el limite."* El limite no se agota
  por tarea, se agota por cuenta y ventana. Una tarea corta detras de otras
  muchas choca igual.
- *"Si falla, reintento y ya."* El reintento no recupera el razonamiento del
  turno perdido, y en un debate multi-ronda pierde tambien el hilo.
- *"Sale aviso por el plan, luego no puedo trabajar."* Al reves: el aviso dice
  que hay que mirar, no que este agotada. Confundir plan con cuota restante
  bloquea sesiones perfectamente utiles — paso la primera vez que corrio esta
  comprobacion, contra una cuenta nueva con su cuota intacta.

## Senales de alarma

- Delegar a Codex sin haber mirado la salida del preflight en esta sesion.
- Un turno que se corta a mitad y se reintenta sin volver a comprobar la sesion.
- Un script que intenta `codex login` de forma automatica: autenticarse es un
  acto de la persona, no de un agente.
- Cualquier salida que imprima tokens. El preflight muestra cuenta, plan,
  vencimiento y los ultimos seis caracteres del `account_id`; nada mas.

## Verificacion

- `node scripts/codex-session-check.mjs` sale `0`, y el email que imprime es el
  de la cuenta que se pretende usar.
- Si salio `2`, quedo escrito en el checkpoint o en la evidencia de la fase que
  se delego igualmente y por que.
