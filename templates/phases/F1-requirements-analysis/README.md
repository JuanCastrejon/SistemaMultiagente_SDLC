# F1 — Requirements Analysis

## Intent

Ejecutar la fase F1 del SDLC bajo el contrato versionado en `phase-contract.yaml`.

## Checklist

- Confirmar owner y participantes declarados para F1.
- Verificar entradas requeridas antes de producir salidas.
- **Producir el borrador con `/enrich-us`**, no a mano — ver abajo.
- Registrar evidencia en `.github/agent-state/evidence/<slice>/F1.yaml` cuando aplique.
- Ejecutar `sdlc phase-gate --phase F1 --slice <slice> --target . --json`.

## Cómo se producen las salidas: `/enrich-us`

La skill `enrich-us` que instala el framework produce **exactamente** las salidas
declaradas de esta fase —borrador enriquecido, readiness `L1/L2/L3`, KPI principal,
matriz NFR mínima y bloque de prior art— y escribe donde F1 las espera:
`.github/agent-state/drafts/<slug>.md`.

```
/enrich-us <#issue|texto de la historia>
```

**Por qué se nombra aquí y no se deja a criterio.** El flujo describía qué producir
y quién, pero nunca con qué, así que la skill quedaba como una herramienta suelta que
cada consumidor descubría por su cuenta. En un consumidor real se usó en 24 de 54
sesiones de un mes, y los dos borradores escritos **sin** ella salieron sin prior art
y sin matriz NFR — que es precisamente lo que el gate de F2 tiene que aprobar.

Un borrador a mano no está prohibido, pero entra a F2 debiendo las mismas secciones.
