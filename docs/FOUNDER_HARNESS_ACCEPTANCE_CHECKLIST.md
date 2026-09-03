# Founder Metrora Harness acceptance checklist

Use this checklist against the packaged Windows build. It is a physical
behavior check, not a substitute for automated tests. A checked box means the
Founder observed the behavior in the packaged application.

## Runtime, Workspace and Sessions

- [ ] Open Harness and see the polished coding cockpit, Session rail, mode,
  model, reasoning and Workspace controls.
- [ ] Select Ollama, LM Studio or llama.cpp and see truthful discovery/error
  state. For llama.cpp, set a valid custom loopback port and verify discovery
  and chat use that same port.
- [ ] Open a local folder, see its bounded Workspace name, switch away and
  back, and restart Desktop; the safe association and profile survive.
- [ ] Create a new Session, verify it is bound to the selected Workspace, and
  verify a prior Session remains intact after creating another one.
- [ ] Navigate to another Metrora section and back; the selected Session and
  durable transcript remain selected.

## One Agent path, model and reasoning

- [ ] Ask a normal question and receive an answer from the selected exact
  model. If the route fails, observe a visible Harness error/retry state.
- [ ] Change model inside the same Session and verify the next actual request
  uses the new model without creating a hidden transcript or fallback engine.
- [ ] Select only a reasoning level supported by the exact route/model and
  verify the selection persists independently per model.
- [ ] When the provider intentionally returns reasoning, observe restrained
  Thinking/Reasoning activity and its collapsed process presentation.
- [ ] Run exact conformance and verify `Verified` appears only after a native
  Tool call, validated arguments, real Tool result continuation and final
  synthesis.

## Metrora facts and coding Tools

- [ ] Ask a current usage/cost/quota/Models/Capacity/Projects/Bench question;
  observe a canonical Metrora Tool card and a natural answer grounded in its
  authority, freshness and coverage.
- [ ] Ask a multi-fact question and observe multiple normal Tool events,
  pairing/call IDs and final synthesis in the same turn.
- [ ] Ask the Agent to inspect, search and read Workspace files; observe
  bounded relative paths and expandable result details.
- [ ] Ask for an edit; observe the exact inline Shield proposal, affected
  relative file, action/risk, Approve/Deny, then the actual diff after approval.
- [ ] Ask it to run a test/command; observe the bounded PowerShell/terminal
  card, status, exit code and expandable output.
- [ ] Ask for Git status/diff/log/current branch; observe read-only Git cards.
  Request staging/commit and verify policy approval. Request push, reset,
  clean, force-push or another remote/destructive operation and verify it
  cannot execute silently.
- [ ] Exercise Ask, Plan, Edit and Build and verify their policy differences
  without a second Agent or planner engine.
- [ ] Delegate a bounded Subagent task and observe child identity, Tool
  activity, terminal state and result propagation to the parent.

## Failure, privacy and boundaries

- [ ] Induce provider failure, observe a truthful error, retry the same turn
  without a duplicate durable user message, and confirm no alternate chatbot
  answers.
- [ ] Confirm no credentials, hidden prompts, raw provider payloads, hidden
  reasoning or unnecessary absolute paths appear in the renderer transcript.
- [ ] Confirm hosted consent is explicit and provider credentials remain in
  protected Desktop custody.
- [ ] Confirm the current Workspace rejects `..`, outside-root absolute paths
  and symlink escapes where the platform can inspect them.
- [ ] Confirm `web_fetch` appears as a normal Tool event and no fake web search
  is offered without a configured search provider. Configure a bounded MCP
  stdio or Streamable HTTP server, verify discovery and stable
  `mcp__server__tool` identity, then confirm its external Tool call is visible
  and cannot bypass Shield approval.

Automated checks and packaging gates must pass before this physical retest is
attempted. This checklist intentionally does not declare PASS in source.
