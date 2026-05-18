# SistemaMultiagente_SDLC

Framework reusable para instalar un SDLC multiagente gobernado en repos greenfield o legacy.

## Estado

- Version inicial: `1.0.0`
- Schema config: `1`
- CLI: Node.js sin dependencias externas
- Politica de instalacion: conservadora, con conflictos a nivel archivo y patch plan revisable

## Comandos

```bash
node ./bin/sdlc.js install --target ../mi-repo --mode greenfield --project-name "Mi Repo" --json
node ./bin/sdlc.js doctor --target ../mi-repo --json
node ./bin/sdlc.js diff --target ../mi-repo --json
node ./bin/sdlc.js upgrade --target ../mi-repo --to-version 1.0.1 --json
node ./bin/sdlc.js rollback --target ../mi-repo --to <backup-id> --json
node ./bin/sdlc.js prune-backups --target ../mi-repo --keep 5 --json
```

## Capas

- `core/`: gobierno, agentes, estado compartido, validators, telemetry y skills protegidas.
- `profiles/`: modos greenfield y legacy brownfield.
- `examples/`: repos ficticios usados como regression suite.
- `schemas/`: contratos versionados.
- `migrations/`: migraciones semver del framework.

## Garantias v1

- No sobrescribe conflictos sin decision humana.
- Crea backup antes de comandos mutantes.
- Escribe `.sdlc/install-manifest.json` y `.sdlc/install-manifest.sha256`.
- Soporta output JSON en todos los comandos para CI.
- No instala dashboards ni stack observable completo; solo schemas, JSONL, hooks y scripts base.
