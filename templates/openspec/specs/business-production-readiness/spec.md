# Business Production Readiness Specification

## Purpose

Define how `{{project.name}}` integrates business value, non-functional requirements and production-readiness evidence into the SDLC flow.

## Requirements

### Requirement: Functional work declares business goal and KPI

Every non-trivial functional or operational change SHALL declare a business goal, value hypothesis and primary KPI before implementation.

#### Scenario: New functional request

- **GIVEN** a request changes behavior, operations or user workflow
- **WHEN** the analyst prepares F1-F3 artifacts
- **THEN** the artifacts include business goal, value hypothesis and primary KPI
- **AND** human review approves the business fit or documents accepted gaps

### Requirement: Every change declares readiness profile

Every governed change SHALL be classified as `L1`, `L2` or `L3`.

#### Scenario: Change classification

- **GIVEN** a change is promoted to planning
- **WHEN** risk and operational impact are assessed
- **THEN** the change declares readiness `L1`, `L2` or `L3`
- **AND** the classification is visible in OpenSpec and phase gates

### Requirement: NFR matrix is explicit

Every non-trivial change SHALL answer security, performance, availability, observability, rollback, data/compliance and cost concerns.

#### Scenario: NFR coverage

- **GIVEN** a change enters OpenSpec
- **WHEN** proposal, design or tasks are written
- **THEN** each required NFR concern has expected behavior, non-goals and evidence
- **AND** non-applicable concerns include a justification

### Requirement: Evidence depth follows readiness level

The SDLC SHALL require evidence proportional to `L1`, `L2` or `L3`.

#### Scenario: L1 evidence

- **GIVEN** a change is `L1`
- **WHEN** it reaches implementation or closure gate
- **THEN** it has business fit, KPI and basic rollback or reversibility notes

#### Scenario: L2 evidence

- **GIVEN** a change is `L2`
- **WHEN** it reaches implementation or closure gate
- **THEN** it has business fit, KPI, operational owner, minimal logging/metrics and expected failure validation

#### Scenario: L3 evidence

- **GIVEN** a change is `L3`
- **WHEN** it reaches implementation or closure gate
- **THEN** it has business fit, KPI, operational owner, integrity or reconciliation evidence when applicable, alerts or equivalent plan, partial-failure evidence, runbook and verified rollback/cutover plan

### Requirement: Post-release follow-up is declared for L2/L3

Every `L2` or `L3` change SHALL declare how stability or learning will be measured after release.

#### Scenario: Post-release block

- **GIVEN** a change is `L2` or `L3`
- **WHEN** release or human closure is prepared
- **THEN** it declares observed KPI, follow-up window and criteria for rework or backlog
