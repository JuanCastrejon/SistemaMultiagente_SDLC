# Skill: orquestacion-multiagente

Protocolo de routing, handoffs y continuidad entre agentes.

## Trigger

Cuando el orquestador delega trabajo o cuando se produce una transición de fase.

## Protocolo de handoff

1. Verificar que el slice tiene definición funcional aprobada (F0–F4 completos).
2. Identificar el agente destino según `.github/agents/ownership-matrix.md`.
3. Escribir handoff en `.github/agent-state/handoffs/` usando el TEMPLATE.md.
4. Actualizar `.github/agent-state/current-slice.md` con estado actual y agente activo.
5. El agente receptor confirma recepción y reporta estado al inicio de su sesión.

## Reglas

- Toda transición de fase requiere handoff explícito.
- No asignar trabajo sin verificar capacidad y contexto del agente destino.
- Si el agente destino está bloqueado, escalar al orquestador con causa documentada.
