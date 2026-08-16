# ADR 0008: Modelo de riesgos de autorización — la firma humana deja de colgar del tier

- Estado: Aceptada — **entra en 2.0.0**, no en una ruptura posterior
- Fecha: 2026-08-13 (propuesta) / 2026-08-14 (aceptada y asignada a 2.0.0)
- Extiende: ADR 0007 (quality-gauntlet-f0-f17), decisión P5
- Origen: contraste adversarial entre dos agentes (Claude Opus 5 y Codex GPT-5.6) sobre los hallazgos de operar el framework en `manga-translator-mvp`
- Consumidor de referencia: `manga-translator-mvp`

## Contexto

El ADR 0007 hizo obligatoria la aprobación humana en tier `core`/`money_path`, y
`src/signoff.js` la implementó como commit vacío firmado con trailer
`Signed-Attestation-Subject`. Operar ese mecanismo en un consumidor real dejó al
descubierto que la **obligación** —quién tiene que firmar y cuándo— nunca se
diseñó con el mismo cuidado que la **verificación**.

Cuatro hechos, todos medidos, que fuerzan este ADR:

1. **`tier` hace dos trabajos incompatibles.** Gobierna los umbrales de calidad
   (`thresholds: { core: 90, standard: 80, shell: 0 }`) y, con la regla de 0007,
   gobierna también la autorización. Su definición mezcla cuatro riesgos
   distintos: *dinero, máquina de estados, seguridad y datos regulados*.
   Consecuencia perversa reproducida: para esquivar una firma basta bajar el
   tier, y eso **también compra diez puntos menos de cobertura**. La regla de
   gobernanza incentiva degradar la calidad.

2. **El caso que lo demostró.** El consumidor declaraba `tier: core` con
   `money_path: false` para una extensión de navegador que traduce manga. Se
   argumentó que no era ninguno de los cuatro riesgos y se reclasificó a
   `standard`. El contraste adversarial lo tumbó con un dato verificable: la
   extensión declara `host_permissions: ["<all_urls>"]`, inyecta content script
   en cualquier origen y tiene service worker. *"Traduce manga" describe el
   producto, no sus privilegios efectivos.* La reclasificación se revirtió.

3. **El interruptor del control estaba fuera del control.** Se propuso declarar
   la política en `.sdlc/config.json`. Ese archivo **no** está en
   `DEFAULT_LOCKED` de `templates/scripts/validate-spec-boundary.mjs`, así que
   un agente podía bajar la política y escribir `approved_by` en el mismo
   commit.

4. **El sujeto de la firma no cubre la política.** `computeTreeHashAtRef` hashea
   el árbol de las **superficies declaradas**. En un repo cuyas superficies son
   `apps/api` y `apps/web`, el `quality-contract.yaml` de la raíz queda fuera
   del hash: se puede mutar la política sin invalidar ninguna atestación.

Y una restricción de producto que este ADR acepta en vez de discutir: a la
escala de un equipo de una persona, con todo controlado por git, una firma
criptográfica no aporta revisión por pares. Lo que aporta es otra cosa —separar
la autorización humana, ligada a una clave, de lo que un agente puede escribir
en un YAML— y solo hace falta donde el riesgo lo justifica.

## Decisión

### D1. Dos ejes separados: `tier` mide, los riesgos autorizan

`tier` queda **exclusivamente** para umbrales de calidad. La obligación de firma
se deriva de riesgos de autorización declarados por superficie:

```yaml
surfaces:
  - id: extension
    path: .
    tier: core                    # solo umbrales
    money_path: false
    regulated_data: false
    security_critical: true       # <all_urls> + content script en cualquier origen
    state_machine_critical: false
```

La obligación desaparece **solo** si los cuatro riesgos están presentes, son
booleanos válidos y los cuatro son `false`. Ausente, `null`, una cadena, un
duplicado o un valor no booleano son fail-closed: obligan. Mismo criterio que ya
aplica a `surfaces: []` desde 2.0.0 — *no clasificado* no es lo mismo que *no
aplica*—, y una superficie `core` heredada sin clasificación explícita conserva
la obligación hasta que una revisión la clasifique.

`id` es obligatorio y único: es la identidad con la que D4 empareja BASE y HEAD.

Se descarta anclar la obligación a `tier` (castiga una etiqueta que existe para
otra cosa), solo a riesgo declarado (evadir sería escribir `false` gratis) y a
la unión de ambos: tres campos bajo el mismo control no son tres barreras —se
cambian en el mismo diff— y esa unión arrastra el incentivo de bajar el tier.

### D2. La política vive en `quality-contract.yaml`

Nunca en `.sdlc/config.json`. El contrato ya está en `DEFAULT_LOCKED`, así que
debilitar la política exige tocar una ruta protegida por el guard de frontera.
Con una advertencia que D4 desarrolla: **el guard decide por ruta, no por
semántica ni por autorización**. Es condición necesaria, no suficiente.

Con dos condiciones que estaban implícitas y hay que hacer explícitas.

**La primera: el guard alcanza el contrato solo si la instalación está en la
raíz del repo git.** Los patrones de `DEFAULT_LOCKED` se comparan por segmentos
desde esa raíz, así que un consumidor instalado con
`sdlc adopt --target apps/extension` tiene su contrato en
`apps/extension/quality-contract.yaml`, ruta que el guard **no** protege. Sin
corregirlo, el argumento de D2 —«ya está protegido»— describe también a la
opción descartada. Por eso ambos contratos pasan a protegerse por **basename a
cualquier profundidad**, que es la misma corrección que ya se aplicó a
`vitest.config` y `stryker.conf` por esta misma topología.

**La segunda: `quality-contract.yaml` es un archivo GESTIONADO.** Su generador
emite hoy `{id, path, tier, money_path, has_ui}` y no conoce los otros tres
riesgos ni `governance`. Clasificar riesgos lo convertiría en «gestionado
modificado localmente» y cada `upgrade` lo reportaría como conflicto cuya única
salida es `--accept-managed`, que lo desengancha **para siempre** de las
actualizaciones del framework. No es una evasión —es fail-closed— pero siembra
el reflejo de «acepta el override para que deje de romper», que es cómo se apaga
un control sin decidir apagarlo. La clasificación de riesgos y
`governance.humanGate` son **propiedad del consumidor, no del template**: el
generador pasa a **preservar** los bloques `surfaces` y `governance` existentes y
solo los escribe cuando el archivo no existe.

La divergencia entre `.sdlc/config.json` y `quality-contract.yaml` pasa de
`warning` a **error** en `signoff` y `phase-gate`, y compara `id`, `path`, `tier`
**y los cuatro riesgos**. Hoy compara solo `id@path`: elevar la severidad sin
ampliar lo comparado no aportaría ninguna cobertura a este eje — sería un aviso
más ruidoso sobre exactamente lo mismo.

### D3. Sujeto de atestación v2

```
{ slice, phase, tree_hash, contract_sha256 }
```

`contract_sha256` es el hash de los bytes del blob de `quality-contract.yaml`
**en el ref atestado**, nunca un valor declarado ni leído del working tree. El
sujeto se sigue recomputando siempre, jamás se recibe declarado.

Y la verificación compara **dos** valores, no uno: el `contract_sha256` del
sujeto —el del ref atestado— y el de HEAD. Recomputar solo en el ref atestado da
siempre el mismo número, así que una mutación posterior sería invisible **por
construcción**: la propiedad que este ADR promete —«una firma deja de valer si
alguien muta la política bajo la que se emitió»— no se sigue de la definición
sola. Si divergen, la política vigente ya no es la firmada y la atestación **no
vale**: `authz-contract-drift`, y `phase-gate` bloquea.

No es frescura, y la distinción importa porque confundirlas ya costó un error en
este mismo mecanismo: el `tree_hash` movido sigue siendo un **aviso**
(`fresh: false`) porque el código cambia todo el tiempo y eso no invalida una
aprobación. La política no cambia todo el tiempo, y cuando cambia, lo aprobado
bajo la anterior deja de estar aprobado. Reparación:
`sdlc signoff --slice <id> --phase <F> --create --record`.

### D4. Obligación efectiva BASE → HEAD

Comparar "la política" contra la base no basta, porque la obligación se deriva
de los riesgos declarados y de la **identidad** de la superficie. Se compara la
obligación efectiva, superficie a superficie:

```text
required_base(superficie) → required_head(superficie)
true → false = downgrade de autorización
```

Lo que cuenta es la **transición del booleano**, no cada mutación de campo:
poner un riesgo en `false` mientras otro sigue en `true` no cambia nada, porque
la obligación seguía siendo `true`.

`id` es **identidad persistente** de la superficie y es obligatorio. El
emparejamiento BASE↔HEAD se hace por `id`: con un `id` estable, renombrar o
mover una superficie se compara con normalidad y no es downgrade por sí mismo.
Se trata conservadoramente como downgrade solo cuando la continuidad de
identidad **no puede demostrarse** — un `id` que desaparece, dos superficies que
se fusionan en una, o una que se parte en varias. **Si BASE no se puede
resolver, se bloquea**: sin comparación no hay garantía.

Un downgrade solo pasa con una **autorización de reducción**, que es un sujeto
distinto del de la atestación de fase de D3 y no debe confundirse con él:

```
{ base_sha, head_sha, contract_sha256_base, contract_sha256_head, surface_ids[] }
```

Un `approved_by` escrito en el mismo diff no prueba nada: es una afirmación del
evaluado, no una autoridad.

**Fuera de este eje, y a propósito:** bajar un umbral, eliminar un gate de
calidad o debilitar su modo **no** son downgrades de autorización. Son controles
de calidad y su protección corresponde a otro mecanismo — el guard de frontera
ya los cubre por ruta—. Meterlos aquí reintroduciría `tier` en la obligación de
firma, que es exactamente lo que D1 separa.

### D5. El decisor del downgrade es `phase-gate`, y solo él

Verificar la atestación que la evidencia declara —lo que 2.0.0 ya hace— **no
basta**: no detecta una obligación que se eliminó. `phase-gate` debe además
**exigir** atestación cuando BASE la requería.

Y `phase-gate` tiene que **correr donde el evaluado no manda**. Hoy
`quality-verify.yml` invoca `governance-check` y `quality-gate`, y ninguno de los
dos mira el gate humano ni las atestaciones: el eje de autorización quedaría
adjudicado únicamente en la máquina del agente — la misma que el encabezado de
ese workflow declara *advisory*. Sin un paso en el workflow gestionado, este ADR
describe un acuerdo de caballeros, no un control. Es el defecto que el ADR 0007
ya cerró para calidad —re-ejecutar en CI y comparar— reabierto para
autorización.

`.github/workflows/` está en `DEFAULT_LOCKED`, así que ese paso no lo puede
quitar el evaluado sin excepción declarada. Consecuencia de alcance: el workflow
gestionado cambia en 2.0.0, y eso va en la lista de rupturas.

La comparación BASE→HEAD de D4 la decide **únicamente** `phase-gate`.
`signoff --create/--record/--verify` construyen y verifican atestaciones, pero no
adjudican downgrades: normalmente ni siquiera conocen el BASE de la evaluación, y
darles voto repartiría el mismo veredicto entre dos sitios con información
distinta.

### D6. Las atestaciones v1 se rechazan visiblemente

`doctor` como error persistente y `upgrade` como acción requerida, tanto para
atestaciones con sujeto v1 como para obligaciones no satisfechas. Un upgrade que
parece exitoso mientras deja firmas muertas difiere el descubrimiento al primer
gate humano.

### D7. Política declarable, con límites

`governance.humanGate.policy` en el contrato: `attestation`, `declarative` o
`none`.

- `attestation` es obligatoria donde D1 obliga, sin excepción configurable.
- `declarative` solo donde ningún riesgo obliga, y **siempre etiquetada como
  garantía no verificable** en el veredicto.
- `none` solo con superficies declaradas y ninguna crítica; se rechaza con
  `surfaces: []` o con criticidad indeterminable.

## Consecuencias

**Es ruptura, y mayor que la de 2.0.0.** Una superficie sin clasificar pasa a
exigir firma, así que todo consumidor existente queda bloqueado en su siguiente
gate humano hasta clasificar sus superficies.

**Esa ruptura se absorbe dentro de 2.0.0**, que aún no está publicada. La
alternativa —dejarla para una 3.0.0— obligaría al consumidor a atravesar **dos
majors seguidas**, y la segunda tocaría el mismo mecanismo que la primera acaba
de mover: sujeto de atestación, `signoff` y `phase-gate`. Migrar dos veces el
mismo control, con dos notas de migración que se contradicen en el mismo
trimestre, cuesta más que clasificar superficies una vez. Una versión sin
publicar puede crecer en alcance; una publicada no. Consecuencia directa y
asumida: **2.0.0 no se publica hasta que D1–D7 estén implementados**, y su lista
de rupturas deja de ser cuatro.

**El fail-closed retroactivo no admite período de gracia, pero sí tiene
alcance.** La obligación derivada de riesgos aplica a las fases con `human_gate`
**posteriores a que exista código que firmar**: F4, F13 y F14. En F2 y F3
—revisión de borrador y validación del issue— no hay árbol de superficies que
atestar, y exigir allí una atestación cuyo sujeto es el hash de las superficies
produce un bloqueo del que **no se sale**: en un repo recién instalado,
`signoff --create` devuelve `signoff-empty-subject`, y la salida —arreglar
`surfaces`— pasa por `quality-contract.yaml`, ruta protegida cuyo permiso se
aprueba… en F2/F3. Un control insatisfacible es exactamente el argumento con el
que el ADR 0007 descartó `platform-review`, y su desenlace previsible es que
alguien relaje el fail-closed bajo presión. En F2 y F3 el gate humano conserva su
forma actual, etiquetado como garantía no verificable.

**Coste para equipos pequeños.** Un repo sin riesgos declarados como críticos no
paga nada: `declarative` con etiqueta visible. El coste aparece exactamente donde
el riesgo lo justifica, que es la propiedad que se buscaba.

**Para el consumidor de referencia:** partir de `security_critical: true` por sus
privilegios efectivos; los otros tres a `false` solo tras revisión. Y si se
quiere `tier: standard` una vez separados los ejes, debe ser una decisión
explícita de bajar el umbral de calidad, aprobada y justificada, no una
consecuencia lateral de negar un riesgo.

## Tests mínimos antes de publicar

1. Editar **solo** el `quality-contract.yaml` raíz invalida una atestación aunque
   el `tree_hash` de superficies no cambie.
2. Riesgo ausente obliga; cada riesgo en `true` obliga.
3. `true → false`, borrado, rename o cambio de ruta quedan bloqueados sin
   atestación v2.
4. `core → standard` con 90→80 queda bloqueado sin aprobación.
5. Una atestación copiada, v1, con commit distinto o con `contract_sha256`
   distinto falla.
6. Divergencia config/contrato falla, no solo avisa.
7. BASE inexistente falla cerradamente.
8. Un E2E con commit firmado válido demuestra que el caso legítimo **sí** pasa.

Los tests ya verdes de árbol, working tree sucio, firmante GPG/SSH y CRLF se
conservan como regresión de la ruta v2.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
|---|---|
| `--acknowledge-breaking` en `upgrade` | No concede capacidad ni deja estado verificable: solo confirma texto. Sería el mismo reflejo de "pegar la bandera" que ya se vio en el gate humano declarativo. Lo sustituye detección con estado bloqueante. |
| Eliminar la firma del framework | Razonable a la escala del mantenedor, pero el framework se publica y no sabe en qué repo cae. Se sustituye por política declarada con límites (D7). |
| Política en `.sdlc/config.json` | Deja el interruptor del control fuera del guard que protege el control. |
| Obligación anclada a `tier` | Convierte una etiqueta de cobertura en señal de autorización e incentiva degradar calidad para esquivar gobernanza. |
| Obligación anclada solo a `money_path`/`regulated_data` | Deja fuera seguridad y máquina de estados, dos de los riesgos escondidos hoy dentro de `core`. |
| Unión de tier + riesgos declarados | Conserva cobertura pero no arregla la confusión: los tres campos están bajo el mismo control y se apagan en el mismo diff. |
| Confiar en el guard de frontera para el downgrade | Decide por ruta; no compara semántica ni prueba revisión humana. |
| Diferir el ADR entero a una 3.0.0 | Fue la posición previa y se revierte. Obliga al consumidor a dos majors seguidas sobre el **mismo** mecanismo —sujeto, `signoff`, `phase-gate`— con dos migraciones que se pisan. 2.0.0 sigue sin publicar: es la última ventana en la que esta ruptura sale gratis en número de versión. |
| Partir el diseño entre 2.0.0 y una minor posterior | Clasificación sin comparación contra BASE permite desclasificar en el mismo commit; comparación sin contrato en el sujeto permite mutar la política sin invalidar evidencia; sujeto anclado sin las otras dos certifica una política que aún puede auto-debilitarse. |

## Estado de la implementación

**Nada de este ADR está implementado TODAVÍA, y conviene no confundirlo con lo
que sí lo está.** Desde 2026-08-14 esto no es roadmap: es **deuda bloqueante de
2.0.0**. La rama de 2.0.0 lleva hoy el sujeto anclado al commit
(`{ slice, phase, tree_hash }`), la verificación de la atestación declarada en
`phase-gate`, y la auditoría de atestaciones en `doctor`/`upgrade`. Eso es la
ruta v1: no computa `contract_sha256` (D3), no distingue sujetos v1 de v2 (D6),
no evalúa riesgos por superficie (D1) ni compara BASE→HEAD (D4).

## Los siete huecos, cerrados (2026-08-15)

Estaban listados como «lo que falta para poder implementar sin reabrir el
diseño». Se cierran aquí, antes de escribir código, porque implementar con ellos
abiertos es exactamente cómo se reabre un diseño a mitad de camino.

### G1. `required(surface)` — el algoritmo canónico

Los cuatro riesgos son un conjunto **cerrado**: `money_path`, `regulated_data`,
`security_critical`, `state_machine_critical`. Ni más ni menos, y el orden no
importa porque la función es un OR.

```
required(surface):
  si surface no es un objeto           → true
  para cada r de los CUATRO riesgos:
    v = surface[r]
    si typeof v !== "boolean"          → true      # ausente, null, cadena, número
    si v === true                      → true
  → false
```

Fail-closed en cada rama, y por el mismo motivo en todas: *no clasificado* no es
*no aplica*. Una superficie heredada sin clasificar conserva la obligación hasta
que una revisión humana la clasifique.

**Casos que la función NO decide sola, porque son del contrato, no de una
superficie:**

- **`surfaces: []`** → obliga. Ya es la regla desde 2.0.0 y no cambia.
- **`surfaces` ausente, `null`, o que no sea una lista** → el contrato es
  **inválido**, código `authz-contract-surfaces-invalid`. Y hay que decirlo
  aparte del caso vacío porque el modo de fallo es distinto y mucho peor:
  renombrar la clave a `Surfaces:` deja que un `(contract.surfaces ?? []).some(…)`
  —el patrón literal que este repo ya usa en cuatro sitios— evalúe un OR sobre el
  conjunto vacío, que es `false`. Con una sola letra mayúscula, ninguna
  superficie obligaría en ninguna fase. Es la misma vacuidad que el ADR 0007
  persigue con `min_denominator`, aplicada al eje de autorización: **la validez
  del contrato se comprueba ANTES de evaluar el OR, nunca dentro de él.**
- **`id` duplicado** → el contrato entero es **inválido**, no «esa superficie
  obliga». Con dos superficies del mismo `id`, el emparejamiento BASE↔HEAD de G2
  es ambiguo, y una ambigüedad en la identidad no se puede resolver
  conservadoramente por superficie: se resuelve rechazando el contrato.
  Código: `authz-contract-duplicate-surface-id`.
- **`id` ausente** → mismo trato. `id` es la identidad persistente; sin ella no
  hay nada que emparejar.
- **Claves desconocidas** en una superficie se **ignoran**. Un `security-critical`
  con guion, o un `securityCritical` en camelCase, no es un riesgo declarado: los
  cuatro nombres son exactos. Y como una clave desconocida no aporta un booleano
  válido a ninguno de los cuatro, el fail-closed de arriba ya obliga — el error
  de tecleo se paga con una firma de más, nunca con una de menos.

### G2. Emparejamiento BASE↔HEAD

Se empareja **por `id`**, nunca por `path`. Un `path` cambia cuando se mueve
código; un `id` es la identidad que el consumidor declara y mantiene.

| Situación | Cómo se resuelve | ¿Downgrade? |
|---|---|---|
| `id` en ambos | se comparan `required(base)` y `required(head)` | solo si `true → false` |
| `id` solo en HEAD (**alta**) | superficie nueva; se aplica su `required` | no |
| `id` solo en BASE (**baja**) | la continuidad **no se puede demostrar** | **sí**, si su `required` en BASE era `true` |
| `path` cambia, `id` estable (**rename/move**) | se compara con normalidad | no por sí mismo |
| **split** (un `id` se parte en varios) | el `id` original desaparece → es una baja | sí, por la baja |
| **merge** (varios `id` se funden en uno) | los `id` absorbidos desaparecen → bajas | sí, por las bajas |
| `path` se **estrecha** con `id` estable | el árbol que la superficie resuelve deja de contener archivos que resolvía en BASE | **sí**: baja parcial |

La última fila no es simétrica con «rename/move», y por eso se explica. La
obligación es un OR por repositorio y **no mira el `path`**; el sujeto de D3 sí,
porque es el árbol de las superficies. Una superficie que conserva su `id` y su
clasificación y cambia `path: .` por `path: docs/` mantiene la obligación intacta
y **vacía lo que la firma cubre**: sale una atestación criptográficamente válida
sobre `docs/` mientras el código con los privilegios queda fuera del hash. Es
`signoff-empty-subject` con un archivo dentro — el caso degenerado, cero
archivos, ya estaba cerrado desde 2.0.0; el útil para un atacante no lo estaba.

Split y merge se tratan como bajas **a propósito**. No hay forma fiable de
distinguir «partí `api` en `api-http` y `api-jobs`» de «borré `api` y creé dos
superficies sin clasificar»: las dos producen exactamente el mismo diff del
contrato. Ante dos lecturas indistinguibles, se elige la que no concede.

Lo que cuenta es la **transición del booleano**, no cada mutación de campo:
poner `money_path` en `false` mientras `security_critical` sigue en `true` no es
downgrade, porque la obligación seguía siendo `true`.

### G3. `BASE` y `HEAD`, exactos

**HEAD** es el commit evaluado: `HEAD` en local; en CI, el SHA del checkout del
PR.

**BASE** es `git merge-base HEAD refs/remotes/origin/<integración>`, donde
`<integración>` es la rama **declarada** en `gitFlow.integrationBranch` de
`.sdlc/config.json` — no la que proponga el PR, ni la que traiga el entorno.

La ref se califica igual que en el guard de frontera: se resuelve el nombre
completo y se exige que viva bajo `refs/remotes/`, dos comprobaciones
independientes. No es coincidencia de estilo, es el mismo ataque — un tag
llamado `origin/develop` hace que BASE y HEAD sean el mismo árbol, y entonces
ningún downgrade es detectable.

**Pero calificar el namespace no basta.** La cadena de candidatos del guard
(`--base`, `origin/$GITHUB_BASE_REF`, `origin/develop`, `origin/main`) deja que
el evaluado **elija contra qué se le compara**, y elegir una base que ya contiene
el contrato debilitado hace que no exista transición `true → false` que
detectar: se empuja `sandbox` con la política ya bajada y se abre el PR contra
`sandbox`. Lo que hoy protege al guard no es su `resolveBase` — es que el
workflow le pasa `--base` interpolado desde la rama declarada, y `phase-gate` no
tiene quien se lo pase. Por eso la rama sale de la **configuración**, nunca de la
cadena de candidatos.

| Situación | Código | Qué hace |
|---|---|---|
| No hay ref de integración remota resoluble | `authz-base-unresolvable` | **bloquea** (exit 2) |
| Hay ref pero `merge-base` falla (clon superficial) | `authz-base-unreachable` | **bloquea** |
| El contrato **no existe** en BASE | `authz-base-contract-ausente` | **avisa** |
| El contrato existe en BASE pero **no se puede leer** | `authz-base-contract-invalid` | **bloquea** |
| El contrato de BASE existe pero es inválido | `authz-base-contract-invalid` | **bloquea** |
| `--base` o `GITHUB_BASE_REF` apuntan a una rama distinta de la declarada | `authz-base-mismatch` | **bloquea** |

Casi todas bloquean por la misma razón, que es la doctrina del ADR 0007 aplicada
aquí: **no poder medir no puede parecerse a no tener nada que reportar**. Sin
BASE no se puede saber qué se perdió, y lo que no se puede saber no se concede.

**Las dos filas del contrato no son la misma cosa**, y separarlas costó una
corrección: que el contrato **no exista** en BASE es el caso de bootstrap —el
primer slice de un repo— y no hay obligación anterior que reducir, así que avisa.
Que exista y **no se pueda leer** sí bloquea: ahí hubo algo y no se puede decir
qué. Unificarlas en un solo código habría hecho imposible el primer slice de
cualquier consumidor.

**Y una fila cuya severidad depende de la fase:** si la fase evaluada no tiene
`human_gate` en HEAD, no poder resolver BASE **avisa** en vez de bloquear. Lo
único que BASE aportaría ahí es descubrir que alguien quitó la puerta, y
bloquear *todas* las fases de un repo sin ref remota —un clon nuevo, la máquina
de quien desarrolla— haría inusable el comando para lo que no está autorizando
nada. El árbitro que cuenta es CI (D5), donde `fetch-depth: 0` es requisito del
workflow y la ref existe por construcción: ahí el detector sí corre.

**Bootstrap.** Un repo cuya rama de integración todavía no existe no tiene BASE,
y por tanto no puede evaluar downgrades. Se bloquea igual, con
`authz-base-unresolvable`, y se sale de ahí creando la rama de integración —
no relajando el control. Es el mismo camino que el guard de frontera ya obliga a
recorrer, así que no añade un paso nuevo al consumidor.

### G4. Precedencia

Tres cosas pueden hablar sobre si una fase exige firma. El orden es:

```
modoExigido(fase, contrato) ∈ { ninguna, declarative, attestation }

  si fase.human_gate !== true            → ninguna
  si algunaSuperficieObliga(contrato)    → attestation
  si no                                  → policyEfectiva(fase)
```

**Tres estados, no un booleano.** Con un booleano, `declarative` y `none` son
indistinguibles cuando ningún riesgo obliga — y ahí vive hoy un bloqueo real
(`human-gate-signoff-missing`) que una lectura literal de la fórmula booleana
borraría: bajo `declarative`, la fase pasaría sin firma **de ninguna clase**, que
es más laxo que el estado actual del framework. Un ADR que endurece un control
no puede aflojarlo por un descuido de tipos.

Leído en palabras, y en orden de autoridad:

1. **`phase.human_gate` es la puerta.** Si una fase no es un punto de aprobación
   humana, no se le exige firma aunque el repo entero sea crítico. Ninguna
   política *añade* gates humanos donde el contrato de fases no los declara; eso
   sería el ADR 0007 reescrito desde otro archivo.
2. **La obligación derivada de riesgos manda dentro de la puerta.** Si alguna
   superficie obliga, la política **no puede debilitarla**: `attestation`, sin
   excepción configurable. Es D1, y es lo que hace que el eje sea de riesgo y no
   de configuración.
3. **La política solo decide donde el riesgo no obliga.** `declarative` acepta
   una firma no verificable, **siempre etiquetada como tal en el veredicto**.
   `none` no exige nada.

4. **La puerta también se puede quitar, y eso es un downgrade.**
   `phase.human_gate` es el AND exterior de todo el modelo y vive en **otro
   archivo**, que ni el sujeto de D3 ni la comparación de D4 miraban. Poner
   `human_gate: false` en F13 apagaba el gate entero sin mover un solo riesgo ni
   un solo hash. Es el hecho 3 del Contexto —«el interruptor del control estaba
   fuera del control»— reproducido un nivel más arriba, dentro del ADR que
   existe para cerrarlo. Por eso:

   - el sujeto de D3 pasa a ser
     `{ slice, phase, tree_hash, contract_sha256, phase_contract_sha256 }`;
   - D4 gana una transición de segunda clase: `human_gate` que pasa de `true` en
     BASE a `false` en HEAD —o una fase con `human_gate` que **desaparece**— es
     `authz-human-gate-removed` y exige autorización de reducción, con la misma
     doctrina de bajas de G2. Es la única excepción a «los controles de calidad
     no son downgrades de autorización», y no la contradice: `human_gate` no es
     un control de calidad, es la puerta que este apartado pone **por encima** de
     todos ellos;
   - los dos contratos se protegen por **basename a cualquier profundidad**, no
     solo por su ruta en la raíz —un consumidor instalado con
     `sdlc adopt --target apps/extension` tiene su contrato fuera del alcance de
     un patrón anclado— y desaparece la ruta alternativa
     `.github/agent-state/phase-contract.yaml` de los candidatos que el harness
     acepta: un contrato de fases en una ruta que ninguna lista protege es una
     puerta trasera al interruptor maestro.

Corolario que conviene decir en voz alta: una superficie sin clasificar hace
`attestation` obligatoria en las fases con `human_gate` **que tienen algo que
atestar**, y ninguna política la baja. Ese es el fail-closed retroactivo que este
ADR acepta — con el alcance por fase que las Consecuencias fijan.

### G5. Alcance de `humanGate.policy`

**Por repositorio, con override por fase. Ni por superficie, ni por slice.**

```yaml
governance:
  humanGate:
    policy: attestation          # attestation | declarative | none
    overrides:
      F2: declarative            # solo donde ningún riesgo obliga
```

- **Por superficie, no**, y es la decisión menos obvia de las cuatro: una fase se
  firma **una vez**, no una vez por superficie. Si la política fuera por
  superficie, una fase que toca dos superficies con políticas distintas no
  tendría veredicto definido — y el desempate acabaría siendo «la más laxa gana»
  o una regla escondida en el código. La obligación *sí* es por superficie (D1);
  la **política** es del repositorio.
- **Por slice, no.** Un slice es una unidad de trabajo del evaluado. Una política
  por slice es una política que el evaluado elige por trabajo, que es
  exactamente lo que D1 existe para impedir.
- **El override por fase sí**, porque las fases son estructura declarada del
  repositorio y viven en un archivo protegido por el guard de frontera. Y solo
  puede debilitar donde ningún riesgo obliga: es el punto 3 de G4, no una
  excepción a él.

`none` se **rechaza como contrato inválido** —no como «sin obligación»— si hay
`surfaces: []` o si alguna superficie tiene criticidad indeterminable. Código:
`authz-policy-none-invalida`. Una política que no se puede sostener no se aplica
en su versión laxa: se rechaza.

### G6. Migración de la evidencia v1

**Qué distingue a una v1 de una v2:** el sujeto. v1 es
`{ slice, phase, tree_hash }`; v2 es `{ slice, phase, tree_hash, contract_sha256 }`.
La distinción se hace por **presencia de `contract_sha256`**, no por un número de
versión declarado: un campo declarado lo escribe el evaluado.

| Comando | Evidencia con sujeto v1 |
|---|---|
| `doctor` | **error persistente**, con la lista de fases y el comando exacto |
| `upgrade` | `action-required`; `--dry-run` reporta cuántas y cuáles, sin escribir |
| `phase-gate` | **bloquea** la fase evaluada |

**Nada queda «como histórico» de forma silenciosa.** Se consideró marcar como
histórica la evidencia de fases ya cerradas y se descarta: una fase cerrada con
una firma que ya no verifica es exactamente el estado que hace creer que algo se
aprobó cuando no se puede demostrar. Si la fase no se vuelve a evaluar, la
atestación v1 no bloquea nada porque nadie la mira; en cuanto se evalúa, bloquea.
Eso no es una regla aparte, es la consecuencia de no tener una.

**Reparación**, y es la misma frase que el CHANGELOG de 2.0.0 ya usa:
`sdlc signoff --slice <id> --phase <F> --create --record`. Sin `--record` el
commit firmado existe pero la evidencia sigue apuntando a la firma vieja.

### G7. Matriz de enforcement por comando

`warning` y `error` no bastan: el mismo hecho tiene severidad distinta según
quién pregunte. Esta tabla es la fuente de verdad.

| Hecho | `doctor` | `upgrade` | `phase-gate` | `signoff` | CI |
|---|---|---|---|---|---|
| Superficie sin clasificar (D1 obliga) | error | action-required | **blocked** si la fase tiene `human_gate` | — | como `phase-gate` |
| Downgrade BASE→HEAD (D4) | error | action-required | **blocked** | **no adjudica** | como `phase-gate` |
| Sujeto v1 (D6) | error | action-required | **blocked** | — | como `phase-gate` |
| `contract_sha256` no coincide (D3) | error | action-required | **blocked** | error al verificar | como `phase-gate` |
| `id` duplicado o ausente (G1) | error | action-required | **blocked** | — | como `phase-gate` |
| BASE irresoluble (G3) | warning | warning | **blocked** | — | **blocked** |
| Política `none` inválida (G5) | error | action-required | **blocked** | — | como `phase-gate` |
| Firma declarativa donde se permite | warning **etiquetado** | — | pasa, etiquetado | — | pasa, etiquetado |

Dos filas merecen explicación porque no siguen el patrón:

- **BASE irresoluble es `warning` en `doctor` y `blocked` en `phase-gate`.**
  `doctor` corre en la máquina de quien desarrolla, donde no tener la rama
  remota es normal (clon nuevo, red caída) y no está adjudicando nada. El gate sí
  adjudica, y ahí no poder comparar es no poder conceder.
- **`signoff` no adjudica downgrades**, y es D5 literal. Construye y verifica
  atestaciones; normalmente ni siquiera conoce el BASE de la evaluación. Darle
  voto repartiría el mismo veredicto entre dos sitios con información distinta.

## Lo que este ADR NO decide

- Si el fail-closed retroactivo admite un período de gracia para consumidores ya
  instalados, o bloquea desde el primer gate. La recomendación del contraste fue
  bloquear; el coste de migración lo decide el mantenedor al implementar.
- La reconciliación del ADR 0007, cuya sección de firma humana sigue describiendo
  un review `APPROVED` verificado por `gh api` mientras `src/signoff.js`
  implementa commit firmado. Queda pendiente de addendum o revisión propia.
