# Migration 1.0.1

Migracion de prueba para validar `upgrade`, backup, manifest integrity y rollback.

## Efecto

Agrega `.sdlc/migrations/1.0.1-applied.txt` y actualiza `frameworkVersion` en `.sdlc/config.json`.

## Convencion de migraciones

Cada directorio `migrations/<version>/` contiene:
- `README.md` — descripcion del cambio, precondiciones y notas de rollback.
- El estado aplicado se registra en `.sdlc/migrations/<version>-applied.txt` dentro del repo consumidor.
- Las migraciones deben ser idempotentes: re-aplicar no rompe nada.

## Trigger

```sh
sdlc upgrade --target <repo> --to-version 1.0.1
```

## Rollback

```sh
sdlc rollback --target <repo> --to <backup-id>
```

El backup-id se devuelve en la respuesta JSON del comando `upgrade`.
