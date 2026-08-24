# Lo que el consumidor `FacturacionDian` rompió, midió y descubrió

> Fecha: 2026-08-21 · Motor evaluado: **2.1.1** · Consumidor: `FacturacionDian`
> Fuente: 54 checkpoints de agosto (436 KB), 222 commits del mes, `sdlc doctor --json`,
> `sdlc upgrade --dry-run`, `.sdlc/install-manifest.json` (280 managedFiles) y
> `.sdlc/overrides.yaml` (147 entradas).
> Documento espejo en el consumidor: `docs/guides/brecha-repo-vs-framework-sdlc.md`.

Este documento propone cuatro cambios al motor. Ninguno es una idea: cada uno sale
de un fallo o una medición reproducible en un repo que lleva un mes en producción
con el framework instalado.

---

## 0. Lo que ya funciona, y conviene decirlo primero

El clobber de `00b92ce` (2026-08-18) destruyó 211 líneas de `project-phases`, 234
de `enrich-us` y otras ~700 repartidas. **Los tres defectos que lo permitieron
están cerrados**, y lo verifiqué contra el árbol, no contra el CHANGELOG:

| Defecto | Versión | Verificación hoy |
|---|---|---|
| `upgrade` pisaba overrides ya aceptados | 2.0.3 | `upgrade --dry-run` devuelve `status: conflict`, **no destruye** |
| `doctor` era ciego al override ya pisado | 2.0.6 | reporta 74 overrides y 72 stale |
| El framework era dueño de `openspec/specs/project-phases/` | 2.1.0 | `project-phases` **ya no está** en los 280 `managedFiles`; `sdlc-phases` sí |

El renombrado de 2.1.0 fue el arreglo correcto. Las cuatro propuestas de abajo son
lo que queda.

---

## 1. `seed-only`: la categoría que falta — *mayor impacto*

### El síntoma

`sdlc doctor` sobre el consumidor devuelve **157 hallazgos**, de los cuales
**72 son `managed-file-override-stale`**. Entre ellos:

```
AGENTS.md
indice-operativo.md
.github/agent-state/phase-status.yaml
.github/agent-state/active-slices.yaml
.github/agent-state/current-slice.md
.github/agent-state/open-risks.md
```

### El diagnóstico

Esos ficheros son **estado vivo del host**, no plantillas. `current-slice.md` y
`open-risks.md` cambian cada sesión por diseño. `active-slices.yaml` cambia en
cada apertura de slice. `AGENTS.md` acumula las reglas del consumidor.

El motor los trata como managed files con `sha256`. **Cada edición legítima los
vuelve stale.** El resultado son 72 hallazgos permanentes que nadie puede cerrar.

Un control cuyas alertas no se pueden atender deja de ser un control: enseña a
ignorar `doctor` entero, y con él los hallazgos que sí importan. En este mismo
consumidor había **uno** que importaba —un `managed-file-drift` real sobre
`quality-contract.yaml`, el único fichero con riesgo de clobber— y estaba
enterrado bajo 72 avisos inertes.

### La confirmación empírica

`sdlc upgrade --dry-run --accept-managed quality-contract.yaml` devuelve
`status: conflict` sobre **nueve** ficheros:

```
AGENTS.md · indice-operativo.md · docs/agents/domain.md · .graphifyignore
.github/agent-state/{phase-status,active-slices,current-slice,open-risks}.*
.github/agent-state/spec-boundary-allowlist.yaml
```

**Son exactamente los mismos.** El motor bloquea el upgrade sobre los ficheros
que el host tiene que editar para operar. No es un caso raro: es el estado normal
de un consumidor vivo.

### La propuesta

Partir `managedFiles` en dos categorías con semántica distinta:

| Categoría | Significado | `upgrade` | `doctor` |
|---|---|---|---|
| `managed` | plantilla propiedad del motor | actualiza, o bloquea si hay override | reporta drift |
| **`seed-only`** | se escribe al instalar; después es del host | **no toca nunca** | **no compara sha** |

Candidatos inmediatos, medidos: `current-slice.md`, `open-risks.md`,
`active-slices.yaml`, `phase-status.yaml`, `AGENTS.md`, `indice-operativo.md`.

**Efecto esperado**: 157 hallazgos → ~85, y los que queden son accionables.

> **Implementado y medido el 2026-08-24.** El efecto agregado acertó —161 → **81**—
> pero **la atribución de esta sección era falsa**, y la corrección está en la §6.
> `seed_only` por sí solo bajó de 161 a 150: **10 hallazgos, no 72**. Los 66
> restantes eran otra cosa.

---

## 2. Contrato de etiquetas: hoy hay tres notaciones

Los dos repos traen `docs/agents/triage-labels.md`. **Solapamiento: cero.**

| Origen | Taxonomía |
|---|---|
| Motor (`templates/docs/agents/triage-labels.md`) | `sdlc:F0..F17`, `readiness:L1/L2/L3`, `surface:backend\|web\|mobile\|docs`, `rework:F8:code-level`, `rework:F9:regression`, `rework:F10:security-re-scan`, `rework:F5:contract` |
| Consumidor | `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix` |

Y existe una **tercera**. El flujo canónico, en F3, exige:

> *«Labels: `ready-for-agent`, `readiness-Lx`»*

`ready-for-agent` es del consumidor. `readiness-Lx` **no existe en ninguno de los
dos ficheros**: el motor escribe `readiness:L1` con dos puntos, no `readiness-L1`
con guion.

**F3 declara como salida obligatoria unas etiquetas que no se pueden crear
copiando ninguna de las dos taxonomías.** Cualquier automatización de publicación
de issues falla o inventa.

### La propuesta

El motor publica la taxonomía de eje (`sdlc:Fx`, `readiness:Lx`, `surface:*`,
`rework:*`) como **contrato**, con notación única y verificable. Las etiquetas de
flujo humano (`needs-triage`, `ready-for-human`…) quedan como extensión del
consumidor. Y la fase F3 cita la notación exacta del contrato.

---

## 3. `enrich-us` está adoptada pero no cableada

`enrich-us` produce **exactamente** las salidas declaradas de F1 —enhanced draft,
readiness `L1/L2/L3`, KPI, NFRs— y escribe en su ruta,
`.github/agent-state/drafts/<slug>.md`.

Pero:

```bash
grep -c "enrich-us" docs/agents/sistema-multiagente/02-flujo-f0-f17.md   # → 0
```

**Cero menciones en el flujo canónico F0–F17**, pese a usarse en 24 de los 54
checkpoints de agosto del consumidor. F1 describe qué producir y nombra al agente,
pero nunca la skill que lo produce.

El coste de la omisión está registrado en el consumidor
(`docs/agents/fases-y-borradores.md:66-69`): dos borradores escritos sin
`/enrich-us` no tuvieron el prior-art ni la matriz NFR, *«que es precisamente lo
que el gate de F2 tiene que aprobar»*.

### La propuesta

F1 del flujo canónico nombra `/enrich-us` como su implementación, y la plantilla
de fase (`templates/phases/F1-*/`) la incluye, en vez de dejarla como skill suelta
que cada consumidor descubre por su cuenta.

---

## 4. Regla de nombres para rutas gestionadas

La causa raíz del clobber no fue un fallo de copia: fue que el motor ocupaba
`openspec/specs/**project-phases**/spec.md` para su taxonomía F0–F17. El
consumidor tiene su propio modelo de fases —F0–F7, los módulos del producto— y
escribió ahí 273 líneas.

2.1.0 lo resolvió renombrando a `sdlc-phases/`. **La propuesta es que la regla
sobreviva al caso concreto**: ninguna ruta gestionada debería ocupar un nombre
genérico que un consumidor pueda querer para su propio dominio. Conviene auditar
los 280 restantes con ese criterio —`quality-contract.yaml`, `phase-contract.yaml`
y `docs/agents/domain.md` son candidatos obvios a revisar.

---

## 5. Nota de método

Una afirmación de esta investigación se corrigió sobre la marcha, y conviene que
quede escrita porque el error es instructivo.

Primero medí que el motor **no traía** las etiquetas de issue, buscando
`ready-for-agent` en su árbol. Cero coincidencias; conclusión aparentemente firme
y equivocada. El motor **sí** trae `docs/agents/triage-labels.md`, con otra
taxonomía.

Buscar el término de un repo en el otro mide **si coinciden los nombres**, no si
existe la capacidad. El hallazgo real —tres notaciones incompatibles— es más grave
que la ausencia que creí encontrar, y solo apareció al comparar los ficheros en
lugar de buscar una cadena.

---

## 6. Corrección de la §1: los 72 stale no eran los ficheros de estado

*Añadido el 2026-08-24, al implementar la propuesta 1 y medir el resultado.*

La §1 diagnosticó **72 `managed-file-override-stale`** y los atribuyó a los ficheros
de estado vivo del host —`current-slice.md`, `open-risks.md`, `active-slices.yaml`,
`phase-status.yaml`, `AGENTS.md`, `indice-operativo.md`—. Los seis ejemplos eran
miembros reales de la lista. **La cifra no era suya.**

Medido el 2026-08-24 con `sdlc doctor --json` sobre el mismo consumidor:

| Paso | Total | `override-stale` |
|---|---|---|
| Antes | 161 | 81 |
| Con `seed_only` | 150 | 71 |
| Con `seed_only` + mirrors derivados | **81** | **5** |

**`seed_only` cerró 10 hallazgos, no 72.** De los 71 que quedaban, **66 eran mirrors
de skills**: 22 skills × 3 entornos (`.claude/`, `.agents/`, `.windsurf/`).

### Por qué los mirrors salían stale, y qué se hizo

Un mirror es función **pura** de su canónica local: `buildSkillMirror(nombre,
canónica)`. Pero `doctor` lo comparaba contra la **plantilla del motor**, que mide
otra cosa: si la canónica del consumidor sigue siendo la que el motor entregó. Para
un consumidor que gobierna sus propias skills —el caso que el framework promueve—
eso es stale permanente, y cada corrida de su bootstrap lo renovaba.

La comparación correcta contra la canónica **local** no solo quita 66 hallazgos:
añade una señal que no existía y que muerde. **Claude Code carga `.claude/skills/`,
no la canónica.** Editar `.github/skills/x/SKILL.md` sin regenerar los mirrors deja
al agente ejecutando la versión anterior de la skill que el repo cree tener, y hasta
ahora nada lo decía. Es `skill-mirror-stale`.

### Un falso positivo por el camino, que vale la pena registrar

La primera versión comparaba el mirror **entero**, pie de procedencia incluido
(`<!-- sdlc-source-sha256: … -->`). Marcó stale a tres mirrors byte a byte
correctos: el motor hashea sobre LF normalizado y el script de bootstrap del
consumidor hasheaba el fichero tal cual, con CRLF en Windows.

Se compara el **cuerpo**. Aunque los hashes coincidieran, comparar el pie mediría lo
que el mirror **declara de sí mismo** en vez de lo que contiene — la misma clase de
check que este motor ya rechaza para la narrativa de un checkpoint.

### El patrón, otra vez

La §5 registra una afirmación corregida por buscar el término de un repo en el otro.
Esta es la misma forma en su variante numérica: **una cifra correcta (72 stale) y una
lista correcta (esos ficheros están stale), unidas por una causa que no se comprobó.**
Bastaba agrupar los 81 paths por prefijo — tres comandos, menos de un minuto — y la
respuesta habría salido el primer día.

Cifra medida sobre una base, atribuida a otra.

---

## 7. Estado de las cuatro propuestas al cerrar el 2026-08-24

| # | Propuesta | Estado |
|---|---|---|
| 1 | `seed-only` | **Implementada.** 12 entradas marcadas. Y la §6 corrige su diagnóstico: el grueso eran mirrors |
| 2 | Contrato de etiquetas | **Implementada.** Notación única publicada + `validate:label-notation` |
| 3 | `enrich-us` cableada | **Implementada** en la plantilla de F1 |
| 4 | Regla de nombres | **Implementada acotada** + auditoría de las 280 rutas |

### 2 — La notación es `eje:valor`, y ahora hay quien lo comprueba

`templates/docs/agents/triage-labels.md` publica la taxonomía de eje como contrato
—`sdlc:F3`, `readiness:L2`, `surface:backend`, `rework:F9:regression`— y separa
explícitamente las etiquetas de **flujo humano** (`needs-triage`, `ready-for-agent`…)
como extensión del consumidor, que el motor no publica ni va a pisar. Las dos
responden preguntas distintas: en qué fase está el trabajo, y quién tiene la pelota.

Lo que faltaba no era la regla: estaba implícita y la desviación apareció igual.
`validate:label-notation` rechaza `readiness-L1`, `sdlc-F3` y compañía en cualquier
documento del framework. Probado con su negativo antes de darlo por bueno.

**Un contrato que nada comprueba se lee como cumplido.**

### 3 — F1 nombra la skill que produce sus salidas

`templates/phases/F1-requirements-analysis/README.md` cita `/enrich-us` en el
checklist y explica qué produce y dónde escribe. Se conserva la evidencia del coste:
en el consumidor se usó en 24 de 54 sesiones, y los dos borradores escritos sin ella
salieron sin prior art ni matriz NFR — lo que el gate de F2 tiene que aprobar.

### 4 — La regla acotada, y qué salió de auditar las 280

La primera versión del validador cubría `docs/`, `scripts/` y `openspec/schemas/`, y
**marcó ~50 ficheros legítimos del motor**. Se descartó: es el mismo fallo que la §1
denuncia. Cubrir más no es proteger más.

`validate:managed-path-names` cubre los dos espacios donde una colisión **destruye**
contenido: `openspec/specs/` —donde ocurrió el clobber— y la raíz del repo. Para
`docs/` y `scripts/` la protección correcta no es estática: la colisión solo existe
contra un consumidor concreto y quien la ve es `detectConflicts` con
`UNMANAGED_EXISTING`, que bloquea antes de escribir.

De la auditoría salieron dos cosas que no estaban en la propuesta:

- **`CLAUDE.md` seguía gestionado.** Es donde un repo con Claude Code acumula sus
  reglas de gobierno, y salió en la medición como stale. Pasa a semilla: el motor
  estaba a un `upgrade` de distancia de pisarlo.
- **`openspec/specs/business-production-readiness/` es la misma forma que
  `project-phases`.** Un consumidor con su propia capacidad de readiness de negocio
  colisionaría. Renombrarla exige migrar a los consumidores instalados, así que queda
  como **riesgo aceptado y escrito** en las exenciones del validador — no como
  descuido. Es la única deuda que la auditoría deja abierta.

### Sobre las 7 fases del consumidor y las 17 del motor

No es una comparación: **son ejes distintos, y el motor ya lo dice**. El `Purpose` de
`sdlc-phases/spec.md` lo deja escrito desde 2.1.0 — F0–F17 son las fases del
**proceso** (cómo una unidad de trabajo se redacta, revisa, planifica, implementa,
verifica y mergea), y el roadmap de producto de un consumidor —olas de migración,
hitos— es otro eje que vive en una spec que el framework **no gestiona**.

Verificado hoy en el consumidor: `project-phases` tiene **0 entradas** en los 280
`managedFiles`, y `sdlc-phases` sí está. La separación funciona. La pregunta de cuál
es mejor no tiene respuesta porque ninguna sustituye a la otra: es exactamente la
confusión que produjo el clobber, y por eso el arreglo fue renombrar, no elegir.
