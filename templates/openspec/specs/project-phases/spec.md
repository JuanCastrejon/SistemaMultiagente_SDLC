# Project Phases Specification

## Purpose

Define the canonical F0-F17 SDLC phases used by `{{project.name}}`.

## Requirements

### Requirement: The SDLC uses F0-F17 phases

The project SHALL use the canonical phases F0 through F17 for governed work.

#### Scenario: Phase lookup

- **GIVEN** an agent plans, routes or verifies work
- **WHEN** it needs the current phase
- **THEN** it reads `.github/agent-state/phase-status.yaml`
- **AND** it validates transitions against `.github/agent-state/phase-graph.yaml`

### Requirement: F3.5 branch phase has a technical id

The display phase `F3.5` SHALL be represented as technical id `F3_5` in files that require stable identifiers.

#### Scenario: Branch phase routing

- **GIVEN** work passes F3
- **WHEN** the branch-from-integration phase is recorded
- **THEN** files use `F3_5`
- **AND** display text may show `F3.5`

### Requirement: Rework is label-driven

Rework SHALL be triggered by explicit labels, not by free-form interpretation.

#### Scenario: Code-level PR feedback

- **GIVEN** PR feedback has label `rework:F8:code-level`
- **WHEN** the orchestrator processes F13 review
- **THEN** the target phase is F8
- **AND** auto routing is allowed if the phase graph marks it `auto: true`

### Requirement: Human gates are mandatory at defined points

The SDLC SHALL require human gates before promotion from draft to issue, before risky implementation and before final merge.

#### Scenario: Missing human gate

- **GIVEN** a slice lacks required human validation
- **WHEN** an agent attempts to advance phase
- **THEN** the phase gate blocks progression
- **AND** the missing evidence is recorded in `.github/agent-state/open-decisions.md`

### Requirement: Active slices coordinate path overlap

The planner SHALL use `active-slices.yaml` to prevent conflicting implementation on the same paths.

#### Scenario: Overlap detected

- **GIVEN** a new slice proposes paths already locked by an active slice
- **WHEN** F5 closes planning
- **THEN** the planner emits a coordination handoff
- **AND** F7 does not dispatch both slices to concurrent F8 on the same paths
