# SistemaMultiagente_SDLC

**A governed, verifiable SDLC harness for AI-assisted software development.**

An open-source framework for installing, running, and verifying a multi-agent SDLC in greenfield and brownfield/legacy environments.

> **BMAD orchestrates; SistemaMultiagente_SDLC orchestrates and verifies.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![npm](https://img.shields.io/npm/v/sistema-multiagente-sdlc.svg)](https://www.npmjs.com/package/sistema-multiagente-sdlc)
[![GitHub](https://img.shields.io/github/stars/JuanCastrejon/SistemaMultiagente_SDLC?style=social)](https://github.com/JuanCastrejon/SistemaMultiagente_SDLC)

---

## Why this matters for AI-assisted software development

AI coding agents can dramatically reduce the cost of implementing software, but generating code is not the same as producing software that is safe, traceable, reviewable and ready to release.

The central problem this project addresses is:

> **How do we allow coding agents to move faster without allowing the agent to become the authority that decides whether its own work is correct?**

SistemaMultiagente_SDLC treats agents as participants in an engineering process, not as the final authority.

The framework surrounds agent-driven implementation with:

- explicit requirements and specifications;
- phase contracts;
- human approval gates;
- deterministic validators;
- quality contracts and measurable thresholds;
- changed-line coverage;
- specification-boundary protection;
- signed human attestations;
- independent CI arbitration;
- regression tests;
- reproducible evidence;
- brownfield adoption controls;
- optional security and external-tool integrations.

The goal is not to prevent agents from making changes.

The goal is to make those changes **measurable, auditable and governable**.

---

## The core idea

A conventional agent workflow often looks like:

```text
Prompt
  ↓
Agent
  ↓
Code
  ↓
"Looks good"
```

SistemaMultiagente_SDLC turns that into:

```text
Requirements
     ↓
Specification
     ↓
Human gate
     ↓
Agent execution
     ↓
Implementation
     ↓
Automated evidence
     ↓
Quality gates
     ↓
Independent CI arbitration
     ↓
Human signoff
     ↓
Release
```

The distinction is deliberate:

> **The agent produces changes. The harness produces evidence.**

The harness therefore does not depend on an agent correctly claiming that its own work is complete.

---

## What the project is

SistemaMultiagente_SDLC is an installable Node.js CLI and SDLC harness for AI-assisted software development.

It provides a reusable engineering layer that can be installed into existing repositories or used to bootstrap new projects.

The published package is:

```text
sistema-multiagente-sdlc
```

CLI:

```text
sdlc
```

The project is distributed under the MIT license.

---

## What problem it solves

AI-assisted development creates several engineering problems that become more important as agents gain more autonomy.

### 1. Specification drift

An agent may modify the implementation and simultaneously modify the criteria used to evaluate that implementation.

The framework therefore protects the specification boundary.

### 2. Self-evaluation

An agent should not be the sole authority for declaring its own work correct.

The framework separates:

```text
execution
```

from:

```text
verification
```

and allows CI to independently recompute evidence.

### 3. Brownfield risk

Installing an AI workflow into an existing repository can accidentally overwrite project conventions, configuration or governance.

The `adopt` workflow is designed to add the harness without blindly replacing existing repository content.

### 4. Non-reproducible quality claims

"Tests passed" is not always enough.

The framework records structured evidence and evaluates explicit quality contracts.

### 5. Governance bypass

If an agent can simply modify the gate, lower the threshold or edit the workflow that evaluates it, the gate is not actually a gate.

The framework therefore treats governance itself as a protected surface.

---

## Evidence and project status

The project is intentionally public and actively developed.

Current repository characteristics:

| Property | Status |
| --- | --- |
| License | MIT |
| Package | `sistema-multiagente-sdlc` |
| Current release | `2.2.2` |
| Distribution | Public npm package |
| CLI | `sdlc` |
| Runtime | Node.js |
| Minimum Node.js | `22.13+` |
| Package manager | pnpm 11.3.0 |
| Repository | GitHub |
| Development model | Open source / public |
| Primary maintainer | Juan Castrejon |

The project is still in an early adoption stage. It is **not presented as a widely adopted framework**.

The focus at this stage is technical maturity, reproducibility and validation through real repository maintenance rather than inflated adoption claims.

Recent releases have been driven by operational findings from using the harness against real consumer repositories.

Examples include:

- reducing false findings in `tools-doctor`;
- treating derived skill mirrors differently from canonical files;
- fixing package-manager flag propagation in `verdict`;
- improving checkpoint selection in `resume`;
- making release and validation behavior reproducible;
- adding regression tests for each discovered failure mode.

The project therefore treats maintenance itself as a source of engineering evidence.

---

## Architecture

The framework is intentionally layered.

```text
┌──────────────────────────────────────────────────────┐
│                    Human Governance                  │
│                                                      │
│ Requirements · Specification · Signoff · Ownership   │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│                 SDLC Orchestration                   │
│                                                      │
│ F0-F17 · phase contracts · slices · agents           │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│                   Agent Runtime                      │
│                                                      │
│ Codex · Claude Code · IDE agents · external tools    │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│                 Verification Layer                   │
│                                                      │
│ validators · quality gates · coverage · governance   │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│                 Independent CI                        │
│                                                      │
│ re-measure · arbitrate · hard-block                 │
└──────────────────────────────────────────────────────┘
```

The important architectural boundary is:

```text
Agent → proposes / implements
Harness → measures
CI → arbitrates
Human → authorizes
```

---

## Quick start

### Install into a new project

From the root of the target repository:

```powershell
npx sistema-multiagente-sdlc init `
  --mode greenfield `
  --project-name "Mi Proyecto"
```

Dry run:

```powershell
npx sistema-multiagente-sdlc init `
  --mode greenfield `
  --project-name "Mi Proyecto" `
  --dry-run `
  --json
```

### Adopt an existing repository

For brownfield repositories:

```powershell
sdlc adopt --target .
```

Diagnostic:

```powershell
sdlc doctor --target . --json
```

---

## Development setup

```powershell
git clone https://github.com/JuanCastrejon/SistemaMultiagente_SDLC.git
cd SistemaMultiagente_SDLC

corepack prepare pnpm@11.3.0 --activate
pnpm install --frozen-lockfile

pnpm run validate
pnpm test
```

The project requires Node.js `>=22.13`.

---

## Runtime multiagente

The `sdlc` runtime provides continuity across agent environments.

```powershell
sdlc session-start --target . --json

sdlc resume --target . --markdown

sdlc save --target . --event manual --json

sdlc continua --target . --platform codex --json

sdlc memory-sync --target . --mode health --json

sdlc validate-runtime --target . --json
```

The runtime is designed around explicit state rather than relying exclusively on conversational memory.

For example:

- `session-start` creates session state and performs health checks;
- `resume` reconstructs context;
- `save` creates checkpoints;
- `memory-sync` manages optional external memory;
- `continua` provides agent continuity across supported environments.

---

## Executable F0-F17 harness

The SDLC is represented as executable phases rather than only documentation.

Example:

```powershell
sdlc phase-gate `
  --target . `
  --phase F5 `
  --slice <slice> `
  --json
```

Governance:

```powershell
sdlc governance-check --target . --json
```

External tooling:

```powershell
sdlc tools-doctor `
  --target . `
  --profile full `
  --json
```

Pull request validation:

```powershell
sdlc pr-body-check `
  --repo . `
  --pr <number> `
  --json
```

Each phase can declare:

- owner;
- participants;
- inputs;
- outputs;
- human gate;
- next phase;
- required evidence.

Evidence is stored in structured form under:

```text
.github/agent-state/evidence/
```

---

## Governance enforcement

The framework does not treat governance as documentation only.

It provides executable controls for:

```text
requirements
    ↓
phase contracts
    ↓
governance checks
    ↓
quality gates
    ↓
human signoff
    ↓
CI arbitration
```

The main commands include:

```powershell
sdlc verdict --target . --json

sdlc status --target . --markdown --write

sdlc status --target . --exit-code

sdlc phase-gate --exit-code
```

`verdict` evaluates consumer validation scripts and produces:

```text
READY
```

or:

```text
NOT-READY
```

`status` combines governance, tools and phase state into a go/no-go snapshot.

---

## Quality gates

Since `1.8.0`, the framework includes a measurable quality-gate model.

The core principle is:

> **Do not make quality claims that cannot be independently measured.**

Quality contracts can define:

- tiers;
- surfaces;
- probes;
- thresholds;
- minimum denominators;
- evidence requirements;
- baseline behavior.

Example:

```powershell
sdlc quality-gate `
  --slice <id> `
  --phase <F> `
  --run `
  --exit-code `
  --json
```

Evidence-only adjudication:

```powershell
sdlc quality-gate `
  --slice <id> `
  --phase <F> `
  --from-evidence
```

Baseline promotion:

```powershell
sdlc quality-baseline `
  --promote `
  --slice <id> `
  --source ci
```

Changed-line coverage:

```powershell
sdlc coverage-diff `
  --base-ref origin/develop
```

---

## The specification boundary

One of the most important controls in the framework is the specification boundary.

The problem is simple:

```text
Agent changes implementation
        +
Agent changes the rules evaluating implementation
        =
Gate bypass
```

The framework therefore protects specifications, contracts, workflows and tool configuration.

The guard:

```text
scripts/validate-spec-boundary.mjs
```

detects protected changes and requires explicit authorization.

In CI, the integration branch is treated as the source of authority rather than allowing the pull request to redefine its own evaluation criteria.

---

## Human signoff

Automated verification does not replace human responsibility.

The framework supports signed attestations tied to the evidence being approved.

```powershell
sdlc signoff `
  --slice <id> `
  --phase <F> `
  --create `
  --record
```

Verification:

```powershell
sdlc signoff `
  --slice <id> `
  --phase <F> `
  --verify `
  --commit <sha>
```

The attestation is bound to the relevant subject rather than merely to a working-tree state.

This is particularly important for single-maintainer repositories where a platform review cannot be treated as an independent approval.

---

## Independent CI arbitration

A local agent must not be able to declare its own result authoritative.

The framework therefore distinguishes:

```text
Local harness
    ↓
advisory evidence
    ↓
CI
    ↓
independent re-measurement
    ↓
authoritative gate
```

The CI workflow should be configured as a required branch-protection check, and changes to the workflow should be appropriately protected through repository governance.

The framework documents these requirements because a workflow that can be freely edited by the evaluated agent is not an independent arbiter.

---

## Security

Security is treated as part of the engineering lifecycle rather than as an afterthought.

The framework already protects several high-value surfaces:

- specifications;
- governance configuration;
- workflows;
- signed attestations;
- external-tool execution;
- managed files;
- release behavior;
- agent-generated changes.

External tool installation is deliberately opt-in.

Commands are represented as argument lists rather than arbitrary shell strings, and executable names are restricted to an explicit allowlist.

The project also distinguishes between:

```text
diagnostic
advisory
blocking
authoritative
```

results instead of treating every automated signal as equivalent.

---

## Codex Security

AI-assisted development increases the importance of security verification because agents can modify code, configuration and automation at high speed.

SistemaMultiagente_SDLC is designed to provide a verification layer around that activity.

Codex Security can complement this architecture by providing security analysis of:

- the harness itself;
- changes produced during agent-assisted development;
- repository configuration;
- workflows;
- code paths modified by agents;
- security regressions introduced during maintenance.

The intended integration model is:

```text
Agent change
     ↓
SDLC quality gates
     ↓
Security analysis
     ↓
Evidence
     ↓
CI arbitration
     ↓
Human authorization
```

The goal is not merely to scan the repository.

The goal is to evaluate whether security verification can become a **first-class, reproducible quality signal inside a governed agentic SDLC**.

---

## API-assisted maintenance

The OpenAI API can be used to support repetitive maintenance and evaluation work around the project.

Potential workloads include:

- pull request analysis;
- issue triage;
- test generation;
- regression analysis;
- skill evaluation;
- documentation maintenance;
- release preparation;
- repository-level evaluations;
- security-related analysis;
- reproducible benchmark runs.

The important constraint is that generated output remains subject to the same verification and governance mechanisms as other changes.

---

## Reproducible evaluation

A major goal of the project is to measure the effect of governance rather than assuming that more agent autonomy automatically produces better software.

The long-term evaluation model is:

```text
Baseline
AI-assisted development
        │
        ▼
    measurements
        │
        ▼
Governed agentic development
SistemaMultiagente_SDLC
        │
        ▼
    measurements
        │
        ▼
      compare
```

Potential metrics include:

- validation failures;
- regressions;
- quality-gate failures;
- changed-line coverage;
- security findings;
- specification violations;
- human intervention points;
- false-positive gates;
- time to diagnose failures;
- time to release;
- rollback frequency.

The project deliberately prefers reproducible measurements over subjective claims of agent quality.

---

## Real-world maintenance evidence

The framework is developed by operating it, not only by designing it.

Recent releases have included fixes discovered from real maintenance scenarios.

Examples:

### `tools-doctor`

A mismatch between declared tools and actual probes caused tools declared in the inventory to remain invisible to diagnostics.

The fix made the inventory the source of discovery and added regression coverage.

### `verdict`

A package-manager flag was being passed to the underlying validation script instead of to pnpm.

The observable symptom was a false `NOT-READY` result even though the consumer's validators were green.

The fix included a regression test comparing the npm and pnpm invocation paths.

### `resume`

Checkpoint selection could prefer a newer generated skeleton over the latest usable checkpoint.

The runtime now distinguishes usable checkpoints from post-merge skeletons.

### `upgrade`

Derived skill mirrors are treated as derived artifacts instead of independent sources of truth, reducing false conflicts while preserving real customizations.

These cases are important because they demonstrate the intended development loop:

```text
Observed failure
      ↓
Root-cause analysis
      ↓
Harness change
      ↓
Regression test
      ↓
Release
      ↓
Re-measure
```

---

## Skills

The framework supports evaluation and gated proposals for agent skills.

Evaluate a skill:

```powershell
sdlc skill-eval `
  --target . `
  --skill enrich-us `
  --json
```

Propose an update:

```powershell
sdlc skill-propose `
  --target . `
  --skill enrich-us `
  --change <change> `
  --intent "descripción"
```

The proposal flow does not directly overwrite the canonical skill.

Instead it produces an auditable proposal under:

```text
openspec/changes/
```

This preserves the distinction between:

```text
agent suggestion
```

and:

```text
approved repository state
```

---

## Brownfield adoption

Greenfield and brownfield projects have different risks.

### Greenfield

```powershell
sdlc install `
  --target ../mi-proyecto `
  --mode greenfield `
  --project-name "Mi Proyecto"
```

### Legacy / brownfield

```powershell
sdlc install `
  --target ../proyecto-legacy `
  --mode legacy `
  --project-name "Proyecto Legacy"
```

For mature repositories:

```powershell
sdlc adopt --target .
```

The adoption model is additive and avoids treating an existing repository as an empty scaffold.

---

## Modes

| Mode | Use case | Behavior |
| --- | --- | --- |
| `greenfield` | New project | SDD + governance bootstrap |
| `legacy` | Existing system | Brownfield discovery + migration-oriented flow |

---

## Agent model

The framework separates agent responsibilities.

| Plane | Examples |
| --- | --- |
| Control | `planificador-opus`, `orquestador-opus` |
| Product | `product-owner-agent`, `project-manager-agent` |
| Definition | `analista-requisitos`, `arquitecto-modular-clean`, `qa-test-architect-agent` |
| Specialists | `api-nestjs`, `web-admin`, `mobile-sync`, `ux-designer-agent`, `tech-writer-agent` |
| Gate | `qa-security-review` |

Agents are participants in the SDLC.

They are not intended to become the sole source of truth for repository correctness.

---

## SDLC phases

The framework models an executable F0-F17 lifecycle.

```mermaid
flowchart LR
  F0["F0 Bootstrap"] --> F1["F1 Requirements"]
  F1 --> F2["F2 Human Review"]
  F2 --> F3["F3 Design"]
  F3 --> F4["F4 Validation"]
  F4 --> F5["F5 Implementation"]
  F5 --> F6["F6 Verification"]
  F6 --> F7["F7 Integration"]
  F7 --> F8["F8 Release"]
  F8 --> F9["F9 Migration"]
  F9 --> F10["F10 Recovery"]
  F10 --> F11["F11 Maintenance"]
  F11 --> F12["F12 Evolution"]
  F12 --> F13["F13 Human Gate"]
  F13 --> F14["F14 Attestation"]
  F14 --> F15["F15 Verification"]
  F15 --> F16["F16 Archive"]
  F16 --> F17["F17 Docs + Traceability"]
```

The exact phase contracts are stored in the repository and should be treated as executable governance rather than merely documentation.

---

## Validators

The framework includes repository-level validation for areas such as:

- configuration schemas;
- personal-path leakage;
- template sanitization;
- managed-content boundaries;
- manifest integrity;
- placeholder scripts;
- external-tool policy;
- governance precedence;
- skill-manifest consistency;
- agent persona schemas;
- documentation links;
- OpenSpec consistency;
- template references;
- model schemas;
- label notation;
- managed path names.

Run the complete validation suite:

```powershell
pnpm run validate
```

Run tests:

```powershell
pnpm test
```

---

## External tools

External tools are optional.

The framework maintains an inventory describing:

- purpose;
- whether the tool is required;
- operational profile;
- installation method;
- manual installation requirements;
- detection strategy.

Diagnostics:

```powershell
sdlc tools-doctor --target . --profile full --json
```

Installation assistance:

```powershell
sdlc tools-install --target . --profile full
```

Installing third-party software is not an implicit side effect of installing the SDLC harness.

---

## Context and knowledge tools

The project can integrate optional tools for different classes of context.

### Graphify

Semantic documentation knowledge graph.

Used for:

- onboarding;
- architecture research;
- documentation relationships;
- semantic discovery.

### CodeGraph

Structural code graph.

Used for:

- symbol discovery;
- call relationships;
- dependency analysis;
- structural navigation.

### Headroom

Optional context proxy for long-running agent sessions.

### Obsidian

Optional local knowledge/checkpoint storage.

### Caveman

Conversation-oriented token compression.

### External skills

Optional agent skills can be synchronized through the bootstrap process.

The framework deliberately distinguishes between semantic context, structural code context and conversational context instead of using one tool for every query.

---

## Codex bridge

If Codex is used as an execution environment, the repository provides a preflight mechanism.

```powershell
node scripts/codex-session-check.mjs
```

The purpose is to detect common environment/session problems before expensive agent work starts.

The preflight does not print secrets or full account identifiers.

See:

```text
AGENTS.md
```

for the repository-specific agent contract.

---

## BMAD relationship

SistemaMultiagente_SDLC is not intended to claim that it replaces every agent orchestration framework.

A useful distinction is:

```text
BMAD
  ↓
orchestration

SistemaMultiagente_SDLC
  ↓
orchestration
+
verification
+
governance
+
quality evidence
```

The projects can therefore coexist.

The goal is not to compete on the number of agent personas or workflows.

The goal is to provide a verifiable engineering boundary around agentic software development.

---

## Design principles

The project is guided by several principles.

### 1. Agents are not authorities

An agent can propose and implement changes.

It should not be the sole authority for deciding whether those changes are correct.

### 2. Evidence beats claims

A gate should consume measurable evidence rather than natural-language claims.

### 3. Governance must be enforceable

A governance rule that can be silently edited by the evaluated agent is not strong governance.

### 4. Human approval remains meaningful

Automation should reduce mechanical review work, not erase accountability.

### 5. Brownfield is a first-class problem

Existing repositories cannot safely be treated as blank scaffolds.

### 6. Every important failure should become a regression

Operational failures are inputs to the harness design.

### 7. Security belongs inside the SDLC

Security verification should participate in the same evidence and gate model as quality.

### 8. Reproducibility matters

The project should make it possible to compare different development strategies using observable measurements.

---

## Roadmap

The roadmap focuses on making the harness increasingly useful as an OSS infrastructure layer for agentic development.

Planned areas include:

- broader agent-runtime interoperability;
- stronger security verification;
- reproducible agent evaluations;
- API-driven maintenance workflows;
- improved brownfield adoption;
- plugin APIs;
- marketplace integration;
- improved documentation;
- internationalization;
- contextual CLI help;
- stronger evidence and benchmark reporting.

The roadmap is intentionally subordinate to real maintenance findings: observed failures and consumer feedback should influence implementation priority.

---

## Contributing

Contributions are welcome.

Before opening a change, read:

- `CONTRIBUTING.md`
- `CODE_OF_CONDUCT.md`
- `SECURITY.md`
- `AGENTS.md`

For development:

```powershell
pnpm install --frozen-lockfile
pnpm run validate
pnpm test
```

Changes to governance, quality gates or security-sensitive paths should include appropriate regression coverage and evidence.

---

## Project philosophy

The project is not an attempt to prove that agents can replace software engineers.

It explores a narrower and more practical question:

> **What engineering infrastructure is necessary for teams to safely increase the amount of software work performed by agents?**

The answer explored here is:

```text
Specification
    +
Governance
    +
Agent execution
    +
Deterministic evidence
    +
Security
    +
Independent verification
    +
Human authorization
```

The long-term objective is to make that model reusable across repositories, agents and development environments.

---

## License

MIT.
