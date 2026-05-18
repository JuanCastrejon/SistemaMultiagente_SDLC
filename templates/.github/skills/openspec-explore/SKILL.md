# Skill: openspec-explore / opsx:explore

Explora el prior art interno antes de proponer una capacidad.

## Trigger

`/opsx:explore <tema>` — siempre antes de `/opsx:propose` en cambios no triviales.

## Pasos

1. `graphify query "<tema>"` — detectar nodos y capacidades relacionadas.
2. `graphify path "<A>" "<B>"` — trazar relaciones cross-module relevantes.
3. Revisar `openspec/specs/` y `docs/` para evidencia documentada.
4. Documentar: hallazgos confirmados, inferencias y vacíos abiertos.
5. Registrar conclusión: reusar / adaptar / construir desde cero.
