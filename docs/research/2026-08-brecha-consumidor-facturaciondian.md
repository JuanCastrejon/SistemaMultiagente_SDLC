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
