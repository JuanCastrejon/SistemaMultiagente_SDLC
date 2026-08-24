---
name: save
description: "Escribe un checkpoint portable en el vault local usando el runtime Node de SistemaMultiagente_SDLC. Usar cuando el usuario invoque /save o pida guardar continuidad."
---

# Save

Comando canónico:

```powershell
npx --no-install sdlc save --target . --event manual --json
```

Reglas:

- Escribe checkpoint local en el vault.
- No promueve a GitHub Issue, OpenSpec ni PR sin gate humano.
- Marcar cualquier decision durable como pendiente de promocion al repo.

## El CLI escribe un esqueleto; la narrativa la escribe el agente

`sdlc save` crea el fichero y responde con las secciones que faltan:

```json
"narrative": { "complete": false, "pending": [
  "Alcance y gobernanza", "Skills y fuentes usadas",
  "Decisiones y trabajo realizado", "Verificacion",
  "Pendientes y siguiente accion" ] }
```

**Un checkpoint con esas cinco en `_(pendiente de redactar)_` no sirve para retomar.**
El criterio es concreto: *si para entender una decisión hay que volver al chat, el
checkpoint falló.*

## La trampa que hace perder el trabajo: los esqueletos del hook

El hook `post-merge` corre `sdlc save` en **cada merge**, automáticamente y con las
secciones **vacías**. Llevan marca de tiempo **posterior** a la del checkpoint que
acabas de redactar, así que un `/resume` ingenuo trae uno de esos y no el bueno.

Medido en un consumidor real: **35 checkpoints en un día, 34 esqueletos**.

**Qué hacer:**

1. Al terminar de redactar, **nombrar el fichero para que ordene el último** — marca
   de tiempo posterior a la del último esqueleto.
2. Declarar en el frontmatter a cuáles sustituye, **con las claves que el CLI escribe**:

   ```yaml
   supersedes: 202608240245-slice-ejemplo.md
   superseded_skeletons:
     - 202608240208-slice-ejemplo.md   # esqueleto autogenerado, sin narrativa
   ```

### El marcador que de verdad decide no está en el frontmatter

Cualquier etiqueta que se invente para marcar «este es el bueno» es **para humanos**:
útil para buscar a ojo, y el CLI no la lee.

Lo que el CLI mira es el **cuerpo**: cuenta cuántas secciones siguen con
`_(pendiente de redactar)_`. Cero pendientes = checkpoint redactado. Está decidido así
a propósito, y la razón vale para cualquier marcador futuro:

> Un campo que declara «completo» es exactamente **igual de fácil de escribir que la
> sección misma**, y se queda obsoleto en cuanto alguien edita el archivo.

Consecuencia práctica: **borrar los `_(pendiente de redactar)_` es lo que convierte un
esqueleto en un checkpoint**. Ninguna etiqueta lo sustituye.

## Qué hace retomable un checkpoint

| Sección | Lo que hay que escribir |
|---|---|
| Alcance y gobernanza | sobre todo **qué NO se hizo**: sin tests, sin commit, excepción declarada. Y si hubo manejo de secretos |
| Decisiones | el **porqué**, y **lo que se descartó con su razón** — sin eso, quien retome lo vuelve a proponer |
| Verificación | el comando **y su salida real**. Distinguir lo verificado de lo supuesto |
| Pendientes | separar lo que espera **decisión del usuario** de lo que solo espera trabajo, cada uno con su archivo o comando de arranque |

> **Lo más valioso de un checkpoint son los callejones sin salida.** «Se intentó X, no
> funciona porque Y, **no volver a proponerlo**» ahorra más tiempo que cualquier
> resumen de lo que sí salió.

## Memoria compartida: revisar antes de escribir

`/save` escribe en el vault. La memoria del agente es **otra cosa** y tiene sus propias
trampas, comprobadas:

- **Buscar el fichero que ya cubre el tema** antes de crear uno nuevo. Duplicar deja
  dos versiones que divergen.
- **Nunca un secreto en el nombre del fichero.** Ocurrió: una credencial compartida
  acabó en el nombre, el frontmatter, el cuerpo **y el índice** de una memoria — justo
  mientras se redactaba del repo.
- Borrar las memorias que resultaron falsas. Una memoria equivocada es peor que
  ninguna: se cita con confianza.

## Un checkpoint no dispara nada. El ledger de lecciones sí

Un checkpoint se escribe y espera a que alguien lo abra. Para que un tropiezo cambie
una skill hay que registrarlo donde se **acumula**:

```bash
npx --no-install sdlc skill-lesson --record --type error --title "titulo corto" --correction "que hacer la proxima vez" --skill save
```

- `--type`: `error`, `blocker` o `repetition`.
- La misma huella (`type` + `skill` + `title`) **sube un contador** en vez de duplicar.
  A las **2 apariciones** deja de ser un incidente y es un patrón.
- `--list` muestra lo acumulado; `--promote <id> --change <slug>` escribe una
  **propuesta** bajo `openspec/changes/` y **nunca** toca `.github/skills/`. Aprobar
  sigue siendo humano.
- El ledger vive en `.github/agent-state/lessons.yaml`, que está en las superficies
  bloqueadas del guard de frontera **a propósito**: borrar el historial de los propios
  errores sería un `rm` que nadie ve. **Registrar es local; commitear es otra
  decisión**, y necesita el gate de quien gobierna el repo.

**Por qué está escrito aquí.** El comando existía desde antes y no figuraba en el
`Uso:` del CLI. Resultado medido: un mes de operación, **cero lecciones registradas**,
y un disparador propio escrito a mano creyendo que no había ninguno. Un control que no
se anuncia no se dispara.
