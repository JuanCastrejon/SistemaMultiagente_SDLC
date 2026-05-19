---
name: ui-ux-diseno
description: "Guide UI/UX design, accessibility and product interface consistency for the configured frontend and design system."
---

# UI/UX Diseno

Use this skill when designing, refactoring or reviewing product interfaces across web, mobile or admin surfaces.

## Context

- Frontend stack: `{{stack.frontend}}`
- Design system: `{{stack.designSystem}}`
- Product surfaces: `{{surfacesList}}`

## Goals

- Keep interface changes aligned with product workflows and domain language.
- Improve usability, accessibility, hierarchy and consistency.
- Translate design recommendations into implementation-ready changes.
- Avoid decorative or marketing-heavy UI in operational tools.

## Procedure

1. Read the feature requirement, OpenSpec change and relevant domain docs.
2. Identify the primary user workflow and the decision the screen must support.
3. Audit layout density, navigation, form ergonomics, visual hierarchy and empty/error/loading states.
4. Check accessibility: contrast, focus, labels, keyboard path and responsive behavior.
5. Reuse existing components, tokens and local patterns before adding new primitives.
6. Provide concrete changes with target files, states and verification steps.

## Output Format

```markdown
## UI/UX Review: <surface>

**Stack**: {{stack.frontend}}
**Design system**: {{stack.designSystem}}
**Workflow**: <workflow reviewed>

### Findings
1. [severity] <summary> - `<file/screen>`: <impact> -> <recommended change>

### Expected States
- Loading:
- Empty:
- Error:
- Success:

### Verification
- <viewport/browser/accessibility checks>
```

## Guardrails

- Do not add new dependencies without an explicit OpenSpec decision.
- Do not hide operational complexity behind decorative layouts.
- Keep copy short, domain-specific and action-oriented.
- Verify that text fits within controls at mobile and desktop widths.
