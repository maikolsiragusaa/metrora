# Metrora Advisor contextual launch V1

Metrora Desktop keeps factual accounting and capacity details in product sections. A contextual launch gives the conversational Advisor one bounded entry point for interpreting the current page scope.

## Contract

The public renderer contract is `advisor-contextual-launch-v1`, schema version `1`, implemented in `app/renderer/advisor/context.ts`.

It carries only:

- the originating supported Desktop section;
- the surface-aware `scopeMode`;
- only the canonical scope dimensions consumed by that surface;
- a Metrora-owned suggested prompt.

The builder applies `ADVISOR_CONTEXTUAL_SCOPE_POLICY` before snapshotting through the existing `AdvisorScope` validator. It does not accept evidence, claims, renderer state, page payloads, selection collections, or arbitrary prose. Invalid optional model state degrades to page scope; malformed required scope fails closed. Compare and Plans deliberately discard unsupported incoming dimensions instead of validating or carrying them.

## Surface matrix: before and after remediation

| Surface | Before remediation | After remediation |
| --- | --- | --- |
| Home / Overview | Inherited global period/range/provider/Project | Supported; current period/range/provider/Project only |
| Spend | Inherited global period/range/provider/Project | Supported; current period/range/provider/Project only |
| Models | Inherited global period/range/provider/Project | Supported; current period/range/provider/Project only |
| Sessions / Activity | Inherited global period/range/provider/Project | Supported; current period/range/provider/Project only |
| Compare | Could inherit custom range and Project | Supported at page scope; current period/provider only; custom dates, Project, and the selected pair are dropped |
| Capacity / Plans | Could inherit hidden provider/Project/range state | Supported as current provider-reported capacity across all providers; no Project/history/custom-range authority and no model |
| Bench | Unsupported in V1 | Bench evidence is truthful only for its own compatible all-provider/all-Project scope; the page has no matching shared scope handoff |
| Pull requests, Insights, Workspace, Settings | Unsupported in V1 | No current Advisor evidence contract makes a truthful page-level investigation for these surfaces |

The contextual affordance is one page/header action: `Ask Advisor`. It is shared by the analytics `TopBar` and the existing Plans header. It is not repeated on metric cards or deterministic Details/Evidence blocks.

## UX and safety behavior

Selecting `Ask Advisor` navigates to Advisor with the canonical handoff. Advisor shows the originating surface, preselects only the supported scope dimensions, and loads the suggested question into the composer. Compare explains that custom dates and Project are not part of its page scope. Capacity shows `Provider-reported now · All providers` and keeps the generic Advisor placeholder dimensions out of the contextual UI. The submitted turn also carries a bounded `advisor-ui-context-v1` envelope with the originating surface, selected scope, and at most a few relevant references; it helps resolve referents but is not factual authority. It never submits the question automatically; the user can edit, send, or discard it.

The Capacity placeholder `today / all providers / all projects / no model` exists only because the shared `AdvisorScope` contract is generic. Provider quota windows, reset timestamps, freshness, and credits remain the authority; Metrora history and Project scope do not silently scope Capacity.

Advisor remains the authority for conversation scope. Existing scope fingerprints filter follow-up history, so changing period, range, provider, Project, or model cannot reuse incompatible factual conversation context. Returning to a product section does not mutate its accounting scope.

The handoff does not add an executor. Provider settings, optimization application, benchmark execution, agent launching, routing changes, and policy changes remain outside Advisor's read-only boundary.

## Public/private and provenance boundary

This is Metrora-owned MIT implementation using the existing Advisor Kernel, eight-tool contract, chat-first model boundary, canonical evidence, privacy projection, and session-local conversation. No dependency was added. No proprietary ranking, forecasting, workload allocation, managed routing, private evaluation, team policy intelligence, or managed inference logic is included.
