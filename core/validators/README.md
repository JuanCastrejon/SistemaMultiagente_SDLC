# Validators

Los validadores del framework deben ser config-driven.

## Reglas

- No hardcodear dominio de un proyecto consumidor.
- Leer `sdlc.config.json` o `.sdlc/config.json`.
- Usar exit code `0`, `1` o `2`.
- Soportar salida JSON cuando se use desde el CLI.
