# ADR 0025 — AI assistant (bring your own key)

Status: accepted · Phase 5 step 1 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0011](0011-gdpr-export-erasure.md), [0018](0018-capacity.md)

## Context

People ask HR questions the app can already answer ("how many leave days do I have left?", "who in my team is off next
week?", "who has time next sprint?"). An assistant lets them ask in plain words. The constraints are the product's:
free tiers, EU hosting, GDPR, and **the assistant must never see more than the person asking may see**. Free AI APIs may
log data and process it outside the EU, so AI is **off by default**, needs consent, and sends as little as possible.

## Decisions

### 1. Bring your own key, fixed providers

- A person (`ai.manage_own_key`) or a workspace admin (`ai.manage_tenant_key`) pastes a provider key. Resolution order per
  request: the user's key, then the workspace key, else `AI_NOT_CONFIGURED`.
- Providers are a **fixed allowlist** with fixed base URLs (no custom URL, so no server-side request forgery): `groq`,
  `openrouter`, `mistral` and `gemini`, all through their OpenAI-compatible chat-completions endpoints with tool calling.
  One adapter, one base URL per provider (`AI_PROVIDERS` in contracts). The model is free text limited to a safe pattern.
- Keys are encrypted at rest with AES-256-GCM, a random 96-bit IV per record, and the master key from `AI_KEY_ENCRYPTION_KEY`
  (32 bytes, base64). The tenant, scope and owner are bound as additional authenticated data, so a ciphertext copied to
  another row does not decrypt. Without the master key, storing keys is refused (`AI_NOT_CONFIGURED`). `key_version` allows
  rotation later. **A key is never returned** (only the provider, model and last four characters), never logged, never put
  in audit entries or errors.
- "Test key" sends a one-word request and reports success or the provider's status class, never its body.

### 2. Off by default, consent, minimal data

- The workspace switch (`ai_workspace_setting.enabled`, `ai.toggle_tenant`, audited) defaults to **off**. While off, every AI
  route except status answers `AI_DISABLED`.
- Before the first message a person accepts a notice (`ai_user_setting.consent_at`, notice version) saying that questions and
  the data needed to answer them are sent to the chosen provider, possibly outside the EU. Without it: `AI_CONSENT_REQUIRED`.
- A second, separate choice `share_people_data` (default **off**) lets the assistant look up **other people** (colleagues'
  absences, availability). With it off those tools are not offered to the model at all.
- Only what the answer needs leaves the server: tool results are trimmed to the fields the tool defines (first names and
  dates, no emails, phone numbers or free text), capped at 8 KB, and the system prompt contains no personal data.

### 3. The assistant acts as the user

- The model never touches the database. It can only call **read-only tools** that run the existing services with the caller's
  `RequestAuth` (`LeaveService`, `GoalsService`, `TasksService`, `CapacityService`), so scopes, masking (sick leave) and `404`s
  hold exactly as in the app. A tool failure is returned to the model as a short error, never details.
- First tools: `get_my_leave_balance`, `get_my_open_tasks`, `get_my_goals` (own data) and `who_is_off`, `find_available_people`
  (people tools, behind `share_people_data` and the permission of the underlying service). No write tools; writes would need an
  explicit confirmation step and come later.
- At most 4 tool rounds per message; a user message is at most 2000 characters; each call has a 30 s timeout.

Tool results can contain text written by other people (a task title, a goal). The system prompt tells the model to treat them
as data, and the tools are read-only, so a hostile title can at worst change the wording of an answer, not any record.

### 4. Storage, retention, limits

- `ai_workspace_setting`, `ai_credential`, `ai_user_setting`, `ai_conversation`, `ai_message` (all RLS, composite foreign keys).
  Conversations belong to one person; everybody else, admins included, gets `404`.
- Conversations are purged after `retention_days` (workspace setting, default 90, 1–365). The purge runs for the workspace on
  every chat request; no scheduler needed.
- Rate limit: 30 user messages per hour per person (counted from `ai_message`), `AI_RATE_LIMITED`.
- Export lists the person's conversations; erasure deletes their conversations, key and settings. Audit: key set/removed
  (scope and provider only), workspace switch and retention (values), never keys, prompts or answers.

### 5. API and web

- `/ai/*`: `GET status`, `PUT consent`, `PUT|DELETE key/me`, `PUT|DELETE key/workspace`, `POST key/test`, `PUT workspace`,
  `POST chat`, `GET|DELETE conversations`, `GET conversations/:id`. Routes are `@RequirePermission` (or `@Authenticated()` with a
  service check where "any of" applies). The provider call goes through an injectable `AiProviderClient` so tests use a fake.
- Web: `/assistant` (own `ai.use` guard) with a chat tab and a settings tab (key, consent, workspace switch for admins). Plain
  request/response, no streaming. Answers are shown as text, never as HTML.

### 6. Out of scope

Streaming, write actions, embeddings/RAG, usage billing, custom provider URLs, per-tenant model policies.
