---
name: backend-audit
description: "Audit backend architecture, module boundaries, layering and testability for the configured backend stack."
---

# Backend Audit

Use this skill when a backend module needs architecture review, refactor planning, migration assessment or production-readiness evidence.

## Context

- Backend stack: `{{stack.backend}}`
- Database stack: `{{stack.database}}`
- Canonical governance: `.github/AGENTS.md`, `AGENTS.md`, `openspec/`, `.github/agent-state/`

## Goals

- Detect layer violations, coupling hotspots and testability gaps.
- Keep module boundaries explicit and aligned with the repo architecture.
- Produce actionable findings with file references, severity and remediation.
- Preserve public contracts while improving internal structure.

## Audit Checklist

1. Identify the module or surface being reviewed.
2. Read the relevant OpenSpec change, domain docs and agent-state handoff.
3. Map entrypoints, application services, domain logic, persistence and external adapters.
4. Check for business logic in controllers, UI handlers, route handlers or infrastructure adapters.
5. Check that validation, authorization, transactions and error handling are explicit.
6. Verify tests cover critical use cases, edge cases and contract behavior.
7. Classify findings by severity: critical, high, medium, low.

## Output Format

```markdown
## Backend Audit: <module-or-surface>

**Stack**: {{stack.backend}}
**Scope**: <files/paths reviewed>
**Readiness impact**: L1/L2/L3

### Findings
1. [severity] <summary> - `<file>`: <why it matters> -> <recommended change>

### Tests or Evidence
- <test/evidence reviewed>

### Follow-up
- <next action or handoff>
```

## Guardrails

- Prefer local patterns already present in the repo.
- Do not introduce framework changes while auditing.
- Keep recommendations slice-sized unless the issue blocks production readiness.
- If the repo is legacy, preserve behavior first and propose incremental seams through OpenSpec.
