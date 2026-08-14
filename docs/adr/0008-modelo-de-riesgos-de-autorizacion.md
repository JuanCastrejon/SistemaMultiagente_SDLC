# ADR 0008: Modelo de riesgos de autorización — la firma humana deja de colgar del tier

- Estado: Propuesta
- Fecha: 2026-08-13
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

La divergencia entre `.sdlc/config.json` y `quality-contract.yaml` pasa de
`warning` a **error** en `signoff` y `phase-gate`: un aviso no protege un
control, y hoy el cruce solo compara `id@path`, no `tier` ni los riesgos.

### D3. Sujeto de atestación v2

```
{ slice, phase, tree_hash, contract_sha256 }
```

`contract_sha256` es el hash de los bytes del blob de `quality-contract.yaml`
**en el ref atestado**, nunca un valor declarado ni leído del working tree. Una
firma deja de valer si alguien muta la política bajo la que se emitió. El sujeto
se sigue recomputando siempre, jamás se recibe declarado.

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
gate humano hasta clasificar sus superficies. El número de versión se fija al
implementar; por magnitud, no cabe en una minor.

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
| Partir el diseño entre 2.0.0 y una minor posterior | Clasificación sin comparación contra BASE permite desclasificar en el mismo commit; comparación sin contrato en el sujeto permite mutar la política sin invalidar evidencia; sujeto anclado sin las otras dos certifica una política que aún puede auto-debilitarse. |

## Estado de la implementación

**Nada de este ADR está implementado en 2.0.0, y conviene no confundirlo con lo
que sí lo está.** 2.0.0 lleva el sujeto anclado al commit
(`{ slice, phase, tree_hash }`), la verificación de la atestación declarada en
`phase-gate`, y la auditoría de atestaciones en `doctor`/`upgrade`. Eso es la
ruta v1: no computa `contract_sha256` (D3), no distingue sujetos v1 de v2 (D6),
no evalúa riesgos por superficie (D1) ni compara BASE→HEAD (D4).

Lo que falta para poder implementar sin reabrir el diseño:

1. Algoritmo puro y canónico `required(surface, contract)`, con tipos válidos,
   valores desconocidos, duplicados y superficie vacía.
2. Reglas de match BASE/HEAD por `id`, y tratamiento exacto de alta, baja, split
   y merge de superficies.
3. Definición exacta de `BASE` y `HEAD` — PR, merge-base, SHA de CI—, con el
   comportamiento en clon superficial y sus códigos de salida.
4. Precedencia entre `phase.human_gate`, `humanGate.policy` y la obligación
   derivada de riesgos.
5. Alcance de `humanGate.policy`: por repositorio, por superficie, por fase o por
   slice. Sin eso, `declarative` y `none` son ambiguos.
6. Migración: qué evidencia v1 queda como histórica, cuál bloquea, cómo se
   re-firma y qué reporta `upgrade --dry-run`.
7. Matriz de enforcement por comando: `doctor`, `upgrade`, `phase-gate`, CI y
   local no pueden inferir severidad solo de `warning`/`error`.

## Lo que este ADR NO decide

- **El número de versión de este modelo.** 2.0.0 es la rama actual, que no lo
  implementa; este ADR describe la siguiente ruptura y su número se fija al
  implementarla.
- Si el fail-closed retroactivo admite un período de gracia para consumidores ya
  instalados, o bloquea desde el primer gate. La recomendación del contraste fue
  bloquear; el coste de migración lo decide el mantenedor al implementar.
- La reconciliación del ADR 0007, cuya sección de firma humana sigue describiendo
  un review `APPROVED` verificado por `gh api` mientras `src/signoff.js`
  implementa commit firmado. Queda pendiente de addendum o revisión propia.
