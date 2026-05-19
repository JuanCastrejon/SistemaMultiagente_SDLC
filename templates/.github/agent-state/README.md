# Agent State

This directory stores the shared operating state for the SDLC control plane.

## Rule

If ownership, phase, risk, decision or gate changes, this directory must reflect it.

## Files

- `phase-graph.yaml`: canonical F0-F17 flow and label-driven rework rules.
- `phase-status.yaml`: current phase, owners and open follow-ups.
- `active-slices.yaml`: in-flight slices and path overlap policy.
- `current-slice.md`: active slice summary.
- `platform-context.json`: TTL lock and resume context written by `scripts/continua.ps1`.
- `handoffs/`: handoff records between agents.
- `telemetry/`: JSONL operational events.
- `calibration/`: review and decision calibration fixtures.
- `drafts/`: local drafts that are not yet promoted to issues, specs or docs.
