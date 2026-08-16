# Rondas adversariales: cómo se reparten los modelos

Quince rondas de revisión adversarial han encontrado defectos reales en esta
rama. Lo que casi las mata no fue la falta de ideas: fue **gastar el modelo caro
en trabajo mecánico** hasta agotar la cuota antes de llegar a las preguntas que
sí necesitaban juicio.

Este documento fija el reparto para que no se vuelva a decidir a ojo.

## La regla

**El modelo lo elige la NATURALEZA del trabajo, no la importancia de la tarea.**

Es la confusión que costó dos rondas. «Esto es importante, va con el modelo
grande» es un error de categoría: un barrido de ocurrencias es importante *y*
mecánico. Un modelo pequeño lo hace igual de bien y deja presupuesto para la
pregunta que de verdad necesita razonar.

Tres preguntas, en orden. La primera que dé «sí» decide:

1. **¿Se responde con un `grep` bien hecho?** → `haiku`.
2. **¿Se responde ejecutando algo y leyendo la salida?** → `sonnet`.
3. **¿Hace falta decidir por qué un razonamiento es insuficiente?** → `opus`.

## El reparto

| Rol | Modelo | Esfuerzo | Por qué |
|---|---|---|---|
| [`rastreador`](../../.claude/agents/rastreador.md) | `haiku` | bajo | Barrido de ocurrencias. Alto volumen, cero juicio. Es la contramedida al defecto más repetido de esta rama —arreglar una ocurrencia y declarar el caso cerrado— y tiene que ser barato para poder lanzarlo siempre. |
| [`mutador`](../../.claude/agents/mutador.md) | `sonnet` | medio | Aplicar mutaciones y correr la suite. Necesita competencia con el código, no juicio de diseño. Es el rol de más volumen de toda la ronda. |
| [`verificador-de-afirmaciones`](../../.claude/agents/verificador-de-afirmaciones.md) | `sonnet` | medio | Comprobar el mensaje de un commit contra el diff. Mecánico, pero requiere ejecutar comandos y leer salidas. |
| [`refutador`](../../.claude/agents/refutador.md) | `sonnet` | medio | Reproducir un hallazgo concreto para tumbarlo. La instrucción es precisa; lo que hace falta es ejecutarla bien. |
| [`adversario`](../../.claude/agents/adversario.md) | `opus` | alto | La única pregunta que no se responde barriendo ni ejecutando: *¿por qué el razonamiento que sostiene esto es insuficiente?* |
| Síntesis | `opus` | alto | Deduplicar hallazgos que dicen lo mismo con otras palabras y emitir el veredicto. Es juicio, no agregación. |

Proporción que sale de aplicar esto a una ronda típica: **un `opus` por cada
cuatro o cinco agentes baratos**. La ronda 14 lo hizo al revés —ocho agentes
`opus`— y murió sin devolver un solo hallazgo.

### Los roles no están disponibles en la sesión que los crea

Medido en la ronda 15: los cinco archivos se escribieron y, en la misma sesión,
despacharlos por nombre falló con `agent type 'rastreador' not found`. **El
registro de roles se lee al arrancar la sesión**, así que un rol nuevo no existe
para quien lo acaba de escribir.

Mientras tanto, el reparto se aplica igual pasando `model` y `effort` en cada
llamada. Es la misma política; lo que se pierde es tenerla escrita en un sitio
en vez de repetida en cada lanzamiento — que era justamente el problema que los
roles resuelven. Cuando la sesión se reinicie, los cinco nombres funcionan.

Y el fallo enseñó algo que vale más que el reparto: **la ronda 15 sobrevivió a
que sus cinco lentes se cayeran** porque la síntesis, al recibir cinco resultados
vacíos, hizo el trabajo ella misma en vez de devolver un informe en blanco — y
encontró cuatro defectos reales en el validador de anclas. Una fase de síntesis
que se limita a agregar habría devuelto «nada que reportar» sobre una ronda que
no se ejecutó. Por eso el script nombra las lentes caídas: un recorte silencioso
se lee como cobertura completa.

## Antes de repartir: ¿hace falta la ronda?

Del `/review` de [gstack](https://github.com/garrytan/gstack), que resuelve el
mismo problema con dos mecanismos que aquí no teníamos:

**Umbral de alcance.** gstack no despacha ningún especialista con menos de 50
líneas cambiadas. Un diff pequeño no justifica una ronda; la revisa quien la
escribió y se acabó.

**Gating adaptativo por tasa de acierto.** Una lente con **0 hallazgos en 10+
despachos** queda marcada como candidata a apagarse. Con dos excepciones
explícitas —seguridad y migración de datos— que se despachan **siempre, aunque
lleven diez rondas calladas**: son pólizas de seguro, y una póliza que solo se
paga cuando se sabe que va a hacer falta no es una póliza.

**Y lo que se apaga, se dice.** Un recorte silencioso se lee como cobertura
completa. Si una ronda deja fuera una lente, el informe lo nombra.

## Codex: cuatro modos, no dos

`scripts/codex-review.mjs` trataba «funciona» y «no funciona» como los dos
únicos estados, y por eso una cuota agotada parecía un fallo del runner. El
preflight de gstack distingue cuatro, y cada uno tiene una respuesta distinta:

| Modo | Qué pasó | Qué se hace |
|---|---|---|
| `disabled` | El mantenedor apagó las revisiones cruzadas | Saltar. No caer a un subagente: apagado significa apagado |
| `not_installed` | No hay `codex` en el PATH | Caer al `adversario` local, y decir cómo instalarlo |
| `not_authed` | Instalado, sin credenciales | Caer al `adversario` local, y decir `codex login` |
| `quota` | Autenticado, sin cuota | Caer al `adversario` local, y decir cuándo se libera |
| `ready` | Todo en orden | Correr la revisión cruzada |

La propiedad que importa: **la revisión cruzada es informativa, no un gate**.
Que Codex no esté disponible nunca puede bloquear el trabajo — sólo cambia quién
hace de segunda voz. Que se ejecutó la vía local en vez de la cruzada sí se
declara, porque una segunda voz del mismo modelo tiene puntos ciegos correlados
con la primera.

## Lo que no se delega

El reparto es para las lentes de una ronda. **La decisión de qué arreglar y cómo
no se delega**: llega a la sesión principal, que tiene el contexto de las quince
rondas anteriores y sabe cuál de los ocho patrones recurrentes tiene delante.

Un subagente empieza en frío. Es su virtud —contexto limpio, sin sesgo de la
revisión previa— y su límite.
