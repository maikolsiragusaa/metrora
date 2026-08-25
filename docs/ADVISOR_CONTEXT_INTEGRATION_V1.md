# Metrora Advisor contextual launch V1

Metrora Desktop keeps factual accounting and capacity details in product sections. A contextual launch gives the existing Advisor one bounded entry point for interpreting the current page scope.

## Contract

The public renderer contract is `advisor-contextual-launch-v1`, schema version `1`, implemented in `app/renderer/advisor/context.ts`.

It carries only:

- the originating supported Desktop section;
- the canonical period and optional custom date range;
- the canonical provider filter;
- the Metrora Project id and canonical display name;
- an optional exact model identity when the source has one that Advisor can investigate;
- a Metrora-owned suggested investigation prompt.

The builder projects fields explicitly and snapshots them through the existing `AdvisorScope` validator. It does not accept evidence, claims, renderer state, page payloads, selection collections, or arbitrary prose. Invalid optional model state degrades to page scope; malformed required scope fails closed.

## Surface matrix

| Surface | V1 behavior | Contextual investigation |
| --- | --- | --- |
| Home / Overview | Supported | Current period/range, provider, Project; measured overview prompt |
| Spend | Supported | Current period/range, provider, Project; measured spend drivers prompt |
| Models | Supported | Current period/range, provider, Project; observed cost-per-call prompt |
| Sessions / Activity | Supported | Page-scope period/range, provider, Project; session/Project spend prompt |
| Compare | Supported at page scope | Does not pass the selected pair; asks about canonical observed model-efficiency evidence |
| Capacity / Plans | Supported | Uses the existing provider-reported quota evidence path |
| Bench | Unsupported in V1 | Bench evidence is truthful only for its own compatible all-provider/all-Project scope; the page has no matching shared scope handoff |
| Pull requests, Insights, Workspace, Settings | Unsupported in V1 | No current Advisor evidence contract makes a truthful page-level investigation for these surfaces |

The contextual affordance is one page/header action: `Ask Advisor`. It is shared by the analytics `TopBar` and the existing Plans header. It is not repeated on metric cards or deterministic Details/Evidence blocks.

## UX and safety behavior

Selecting `Ask Advisor` navigates to Advisor with the canonical handoff. Advisor shows the originating surface, preselects the supported scope dimensions, and loads the suggested question into the composer. It never submits the question automatically; the user can edit, send, or discard it.

Advisor remains the authority for conversation scope. Existing scope fingerprints filter follow-up history, so changing period, range, provider, Project, or model cannot reuse incompatible factual conversation context. Returning to a product section does not mutate its accounting scope.

The handoff does not add an executor. Provider settings, optimization application, benchmark execution, agent launching, routing changes, and policy changes remain outside Advisor's read-only boundary.

## Public/private and provenance boundary

This is Metrora-owned MIT implementation using the existing Advisor Kernel, seven-tool contract, canonical evidence, privacy projection, and session-local conversation. No dependency was added. No proprietary ranking, forecasting, workload allocation, managed routing, private evaluation, team policy intelligence, or managed inference logic is included.
