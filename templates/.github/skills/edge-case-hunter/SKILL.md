---
name: edge-case-hunter
description: "Structured edge-case checklist for F3/F4 before implementation. Adapted from BMAD-METHOD patterns without installing the full framework."
---

# Edge Case Hunter

## Goal

Produce an edge-case inventory for a capability before implementation starts. The goal is not to block delivery; it is to force hard cases into design time instead of QA or production.

## When To Use

- **F3 Design** — before closing design and moving to implementation.
- **F4 Validation** — pre-merge review when design skipped edge-case review.

## Checklist

Answer every dimension. A "not applicable" answer must include a one-line justification.

### 1. Invalid Or Boundary Input

- [ ] Empty, null or undefined input.
- [ ] Zero-size input: empty array, empty string, object without properties.
- [ ] Valid min and max boundary.
- [ ] Just outside valid boundary.
- [ ] Wrong types.

### 2. Concurrency And Shared State

- [ ] Two users execute the same operation on the same resource.
- [ ] Read/write race condition.
- [ ] Retry after partial state change.

### 3. Partial Failure And Recovery

- [ ] Step N fails after step N-1 already changed state.
- [ ] Rollback or explicit partial-state handling.
- [ ] Error message names the failing step enough for recovery.

### 4. External Dependencies

- [ ] External service timeout.
- [ ] Unexpected response shape.
- [ ] Retry idempotency.

### 5. Authorization And Privacy

- [ ] User changes an ID in the URL or payload.
- [ ] Logs or errors expose sensitive data.
- [ ] Permission validation happens on the server, not only in UI.

### 6. Volume And Performance

- [ ] Large result set.
- [ ] Required indexes for queries.
- [ ] Explicit response limits.

## Expected Output

Add an `### Edge cases` section to the design or local issue with:

- Cases that pass.
- Cases that create implementation tasks.
- Cases that do not apply, with justification.

## Limits

- Do not invent unrelated cases.
- If investigation takes more than 30 minutes, create a spike.
- This complements QA; it does not replace it.
