# Advisor package spike record

Date: 2026-08-25

This record captures bounded package checks for the Advisor convergence work. No package from this record was added to the desktop app dependency graph.

| Candidate | Observed version | License | Decision for this wave |
| --- | --- | --- | --- |
| `@assistant-ui/react` | `0.15.16` | MIT | Defer; retain Metrora-owned conversation state and UI contracts. |
| `@assistant-ui/react-ai-sdk` | `1.4.7` | MIT | Defer with its AI-SDK/cloud transitive boundary. |
| `ai` | `7.0.79` | Apache-2.0; Node 22+ | Defer behind a future isolated ESM adapter. |
| `@ai-sdk/openai` / `@ai-sdk/anthropic` / `@ai-sdk/google` | `4.0.47` / `4.0.42` / `4.0.51` | Apache-2.0 | Defer; existing direct provider adapters preserve fixed origins and custody. |
| `recharts` | `3.10.1` latest checked; `dash` remains on `3.8.1` | MIT | Do not add to desktop; native SVG keeps the same Metrora-owned data contract and avoids a second desktop chart dependency. |
| AG-UI | design concepts only | n/a | Small design-only alignment in `agui-alignment.ts`; no runtime dependency. |

The assistant-ui package was inspected for its optional managed-cloud boundary. Its package metadata and exports reference `assistant-cloud`; Advisor does not enable managed thread persistence, telemetry, file storage, or cloud transport. The Vercel AI SDK spike also confirmed that model-string/gateway paths are not compatible with Metrora’s fixed-origin rule; any future adoption must use direct provider instances behind an isolated ESM boundary and the existing Electron custody/IPC boundary.

The current desktop presentation uses Metrora-owned `AdvisorPresentationBlockV1` values and native SVG. `THIRD_PARTY_NOTICES.md` therefore remains unchanged. Re-run package metadata and recursive license checks before any future dependency adoption.

References: [assistant-ui](https://www.npmjs.com/package/%40assistant-ui/react), [AI SDK](https://www.npmjs.com/package/ai), and [Recharts](https://www.npmjs.com/package/recharts).
