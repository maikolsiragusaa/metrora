# Codebuff

Codebuff local chat usage, credit cost and tool activity.

- **Source:** `src/providers/codebuff.ts`
- **Loading:** eager
- **Test:** `tests/providers/codebuff.test.ts`

## Where it reads from

Codebuff retains the former Manicode directory name on disk. By default Metrora scans every installed channel:

```text
~/.config/manicode
~/.config/manicode-dev
~/.config/manicode-staging
```

Set `CODEBUFF_DATA_DIR` to scan one explicit root instead. Passing a provider override has the same single-root behavior.

Each channel uses:

```text
<channel>/projects/<project>/chats/<chat-id>/
├── chat-messages.json
└── run-state.json                 optional
```

A chat is discovered only when `chat-messages.json` exists. When available, `run-state.json` supplies the original working directory so the session is grouped under the real project basename rather than a sanitized storage folder.

## Storage format

`chat-messages.json` is a JSON array. The parser emits one call for each `ai`, `agent` or `assistant` message that contains either token usage or a non-zero Codebuff credit value.

Token usage is read in this order:

1. direct message metadata (`metadata.usage` or `metadata.codebuff.usage`);
2. the newest assistant usage entry in the stashed RunState message history;
3. no tokens, with cost derived from credits when credits are available.

The parser accepts common camelCase and snake_case token names for input, output, cache read and cache creation. When token counts identify a priceable model, Metrora calculates cost from those tokens. Otherwise credits are converted using the conservative public pay-as-you-go rate of **$0.01 per credit**.

Model attribution prefers direct metadata, then the stashed provider model, then the observed Codebuff agent type, and finally the generic `codebuff` identifier.

Tool blocks are normalized into Metrora's canonical Read, Grep, Glob, Edit, Write, Bash, Agent, TodoWrite, WebFetch and WebSearch categories where a known mapping exists. Terminal command blocks also populate the bash-command breakdown. Framing tools such as `suggest_followups` and `end_turn` are ignored for task classification.

Messages with neither tokens nor credits are skipped. A missing or malformed chat file produces no calls rather than failing the provider scan.

## Caching

Codebuff is an eager provider using the shared session cache. Each chat directory is represented by its `chat-messages.json` source. `CODEBUFF_DATA_DIR` and the provider parser version participate in the configuration fingerprint used by the cache layer.

The provider reads only local Codebuff files. It does not call a Codebuff billing API to reconcile credits, subscriptions or invoices.

## Deduplication

Each call uses:

```text
codebuff:<absolute-chat-directory>:<message-id-or-array-index>
```

The absolute chat directory keeps identical message IDs from separate chats distinct.

Session IDs include the channel and chat ID when the path follows the normal store layout:

```text
<channel>/<chat-id>
```

This prevents the same timestamp-named chat under stable, development and staging channels from collapsing into one session.

## Quirks

- Codebuff was formerly named Manicode, so the default storage directories intentionally retain `manicode`.
- Credit-derived cost is a conservative estimate. Subscription users may pay less than the displayed pay-as-you-go equivalent.
- Token-priced cost takes precedence over credit conversion when usable token counts and model pricing exist.
- User messages are attached to the next accounted assistant message and cleared after that call.
- A chat ID is commonly an ISO-like timestamp; it supplies a fallback timestamp when message metadata does not.
- Tool and agent blocks may be nested. The parser walks nested agent blocks recursively.

## When fixing a bug here

1. Test stable, development and staging roots when changing discovery.
2. Preserve the single-root behavior of `CODEBUFF_DATA_DIR` and explicit overrides.
3. Keep token-based pricing ahead of credit conversion.
4. Test direct usage, stashed RunState usage and credit-only messages separately.
5. Preserve channel-scoped session IDs and absolute-path message deduplication.
6. Use sanitized fixtures; chat messages and working directories can contain private information.
