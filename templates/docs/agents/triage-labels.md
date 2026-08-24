# Triage Labels

## Notación: `eje:valor`, con dos puntos

Las etiquetas de eje que publica el framework usan **dos puntos**, siempre:
`sdlc:F3`, `readiness:L2`, `surface:backend`, `rework:F9:regression`.

**No hay variante con guion.** `readiness-L2` no es la misma etiqueta que
`readiness:L2` — es una etiqueta que no existe, y `gh issue edit --add-label` la
crea silenciosamente como una tercera taxonomía paralela.

Esto no es un detalle de estilo. Medido en un consumidor real: su flujo declaraba
como salida obligatoria de F3 unas etiquetas —`readiness-Lx`, con guion— que **no
existían en ninguna de las dos taxonomías vigentes**. Cualquier automatización de
publicación de issues contra esa línea falla o inventa.

El validador `validate:label-notation` rechaza la variante con guion en cualquier
documento del framework.

## Etiquetas de eje — contrato del framework

| Label | Uso |
| --- | --- |
| `sdlc:F0`..`sdlc:F17` | fase actual |
| `readiness:L1` | bajo riesgo |
| `readiness:L2` | cambio funcional normal |
| `readiness:L3` | regulado, seguridad, dinero o cutover |
| `surface:backend` | backend/API |
| `surface:web` | web/admin |
| `surface:mobile` | mobile/sync |
| `surface:docs` | documentacion |
| `rework:F8:code-level` | volver a implementacion |
| `rework:F9:regression` | volver a QA |
| `rework:F10:security-re-scan` | repetir security review |
| `rework:F5:contract` | revisar contrato/plan |

Son el eje del método: dicen **en qué fase está** el trabajo, **cuánto riesgo**
tiene y **qué superficie** toca. Un agente decide con ellas.

## Etiquetas de flujo humano — extensión del consumidor

El framework **no** las publica y no las va a pisar. Un repo que trabaja con
personas suele necesitar además algo como:

`needs-triage` · `needs-info` · `ready-for-agent` · `ready-for-human` · `wontfix`

Dicen **quién tiene la pelota**, que es una pregunta distinta de en qué fase está.
Por eso los dos conjuntos conviven sin solaparse: solapamiento medido, cero.

Si el consumidor las usa, van en su propio documento y con su propia notación. Lo
único que este contrato exige es que **no reetiqueten un eje** — es decir, que no
aparezca un `readiness-L1` compitiendo con `readiness:L1`.

## Crearlas en un repo nuevo

```bash
for f in $(seq 0 17); do gh label create "sdlc:F$f" --force; done
for l in readiness:L1 readiness:L2 readiness:L3; do gh label create "$l" --force; done
for s in backend web mobile docs; do gh label create "surface:$s" --force; done
```
