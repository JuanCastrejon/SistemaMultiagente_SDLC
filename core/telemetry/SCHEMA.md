# Telemetry v1

La v1 instala schema, JSONL y scripts base. No instala dashboard ni storage externo.

## Eventos

```json
{
  "version": 1,
  "timestamp": "2026-05-18T00:00:00Z",
  "kind": "phase_transition",
  "project": "project-slug",
  "slice": "slice-id",
  "from": "F4",
  "to": "F5",
  "actor": "orquestador-opus"
}
```

Kinds canonicos:

- `phase_transition`
- `handoff_created`
- `validator_result`
- `rework_requested`
- `escalation`
- `publish_trace`
