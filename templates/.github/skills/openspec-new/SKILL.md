# Skill: openspec-new / opsx:new

Inicia un nuevo change OpenSpec con el enfoque artefacto por artefacto.

## Trigger

`/opsx:new <change-name>` — cuando se quiere crear un change nuevo paso a paso.

## Pasos

1. **Si no hay input claro, preguntar qué se quiere construir.**

   Derivar nombre kebab-case desde la descripción.

2. **Determinar el schema del workflow.**

   Usar el schema por defecto (omitir `--schema`) salvo que el usuario pida uno específico.

3. **Validar readiness gate antes de abrir el change.**

   Para cambios funcionales no triviales, verificar:
   - business fit / objetivo de negocio
   - KPI principal
   - readiness profile `L1 | L2 | L3`
   - matriz NFR mínima
   - aprobación humana `## [validation]`

   **Si falta alguno**: STOP → enrutar a `/enrich-us` o `analista-requisitos`.

4. **Crear el directorio del change.**

   ```bash
   openspec new change "<name>"
   ```

5. **Mostrar estado de artefactos.**

   ```bash
   openspec status --change "<name>"
   ```

6. **Obtener instrucciones del primer artefacto.**

   ```bash
   openspec instructions <first-artifact-id> --change "<name>"
   ```

7. **STOP — esperar dirección del usuario.**

## Output

Resumen con:
- Nombre y ubicación del change
- Schema/workflow y secuencia de artefactos
- Estado actual (0/N artefactos completados)
- Template del primer artefacto
- Prompt: "Ready to create the first artifact?"

## Guardrails

- NO crear artefactos todavía — solo mostrar instrucciones.
- NO avanzar más allá del template del primer artefacto.
- Si el nombre no es kebab-case, pedir uno válido.
- Si ya existe un change con ese nombre, sugerir continuarlo.
