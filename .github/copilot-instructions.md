Principles we MUST follow when writing code:

- Simplicity as a scaling strategy (dumb, explicit, predictable components)
- Minimal moving parts
- Maintainability
- Code as documentation (comments should only be used for non-obvious decisions
  or for JSDoc).
- Functions should fail fast.
- Files and modules must not be god files. Modularization is encouraged where it
  makes sense and makes the codebase maintanable.
- As a general rule, files should not be more than 70 lines long. If we have to add comments to subdivide a file, that's a sign it should be split into multiple files.

BUSINESS_CONTEXT: WhatsApp Sales Bot for Totem, a Calidda gas company ally in
Peru.

WHAT_WE_DO:

- Sell household appliances (smartphones, kitchens, refrigerators, laptops, TVs)
- Customers pay through monthly Calidda bill (Calidda handles
  payments/collections)
- Operate in Lima Metropolitana and Callao only

CLIENT_SEGMENTS:

- FNB (premium): Good payment history, flexible rules
- GASO (majority): Calidda gas clients, restrictive rules, specific product
  combinations

BOT_OBJECTIVES:

- Qualify client eligibility (check FNB first, then GASO)
- Offer appropriate products based on credit line
- Drive conversation toward sale
- Escalate to human when needed
- Avoid overwhelming/confusing client
- Keep internal validation rules private

ENGINEERING_DISCIPLINE: Senior-level decision making and verification.

TASK_CLASSIFICATION:

- High-rigor: Features affecting user flows, unclear bugs, architecture changes,
  UX modifications, external integrations, cross-cutting refactoring
- Medium-rigor: Component additions following patterns, API endpoint updates,
  form validation, business logic, tests
- Low-rigor: Typos, content, comments, formatting, known micro-patterns

CRITICAL_THINKING (high-rigor):

- MUST: Question requests conflicting with usability, consistency, or
  architecture
- MUST: Propose alternatives when better approaches exist
- MUST: Consider full user/system context, not just immediate task
- MUST: Use decision rubric to evaluate approaches systematically

DECISION_RUBRIC (evaluate approaches against project principles):

- Complexity: Does this add unnecessary moving parts? Which approach is dumbest?
- Discoverability: Will this be obvious to others? Is the pattern explicit?
- Coupling: Does this introduce dependencies between unrelated parts?
- Pattern match: Does this already exist? Does it fit established patterns?
- Real need: What problem does this solve? Is there a simpler solution?

EXAMPLES_PUSHBACK:

Good pushback:

- Request: "Add loading state to this component"
- Response: "This component is used in 12 places. Applying rubric: 1)
  Complexity: Should loading be internal or controlled by parent? 2) Pattern
  match: How do other components handle loading? 3) Discoverability: Prop-based
  or state-based? What's the use case to decide best approach?"

- Request: "Store conversation context in Redis"
- Response: "Current setup uses SQLite for persistence. Applying rubric: 1)
  Complexity: Redis adds infrastructure dependency. 2) Real need: Is SQLite a
  bottleneck? 3) Coupling: Adds deployment complexity. What specific problem are
  we solving? Can we optimize SQLite first?"

Bad pushback:

- Request: "Fix the button alignment"
- Response: "Are you sure?" (overthinking trivial task without rubric
  justification)

DEBUGGING_METHODOLOGY (high-rigor, unclear bugs):

- MUST: Reproduce in minimal isolated case before fixing
- MUST: Form hypothesis → test incrementally → verify root cause
- NEVER: Assume cause and fix without verification
- NEVER: Treat unfamiliar syntax as bug (may be newer version)
- WORKFLOW: Reproduce → Hypothesis → Test → Verify → Fix

EXAMPLE_DEBUGGING:

Issue: Svelte component not updating when prop changes Bad approach: See
bind:value, assume it's wrong, change to controlled pattern Good approach:

1. Create minimal repro (single component, single prop)
2. Check if it's reactivity issue (is prop primitive vs object?)
3. Query context7 for current Svelte 5 reactivity patterns
4. Test hypothesis (is parent updating? is child receiving?)
5. Fix verified root cause

RESEARCH_REQUIREMENTS:

- MUST: Query context7 when:
  - Working with Svelte/SvelteKit APIs, runes, or syntax → /sveltejs/kit or
    /sveltejs/svelte
  - Using external libraries/packages → query that library
  - Encountering framework-specific patterns → query framework docs
  - Uncertain about current best practices → research
- MUST: Verify syntax/patterns for recently updated packages (Svelte 5+,
  SvelteKit 5+)
- EXAMPLE: Before changing $state syntax, query /sveltejs/svelte to confirm
  current usage

QUALITY_GATES (all rigor levels):

- MUST: Consider maintainability before adding code
- MUST: Check for existing patterns/utilities before creating new
- MUST: Verify changes don't break accessibility, performance, user flows
- SHOULD: Suggest refactoring when detecting code smells
- SHOULD: For medium/high-rigor: Check if change introduces coupling or tech
  debt

MONOREPO: Bun workspaces, 3 apps (backend/frontend/notifier), 3 packages
(core/types/tsconfig) PACKAGE_DEPS: Use workspace:\* protocol in package.json
for internal dependencies

BACKEND: Hono + Bun + SQLite (bun:sqlite) at apps/backend/src/index.ts

- Context obj c NOT req/res: app.get('/path', (c) => c.json({...}))
- Middleware: app.use('/api/\*', requireAuth) then app.route('/api/catalog',
  catalog)
- Auth: Cookie sessions (Oslo), RBAC roles: admin|developer|sales_agent
- Database: SQLite booleans are INTEGER 0/1, schema at db/schema.sql, seed via
  cd apps/backend && bun run seed

FRONTEND: SvelteKit 5 with Svelte 5 runes at apps/frontend/src

- Dashboard for conversation monitoring, analytics, catalog management
- SSR + client hydration, hooks.server.ts validates sessions
- API calls via centralized client at lib/utils/api.ts (handles auth cookies)

NOTIFIER: Separate Node.js service at apps/notifier/src

- Async WhatsApp queue for internal team alerts

DATABASE: apps/backend/src/db/schema.sql

- Static files: /static/\* → data/uploads/catalog/{segment}/{category}/

ARCHITECTURE: Pure functional state machine + command pattern

STATE_MACHINE: packages/core/src/state-machine/transitions.ts

- Flow:
  INIT→CONFIRM_CLIENT→COLLECT_DNI→WAITING_PROVIDER→COLLECT_AGE→OFFER_PRODUCTS→HANDLE_OBJECTION→CLOSING
- Signature: transition({ currentState, message, context }) → { nextState,
  commands, updatedContext }
- Business logic lives in @totem/core, backend ONLY executes commands

COMMAND_PATTERN:

- Types: CHECK_FNB|CHECK_GASO (provider APIs), SEND_MESSAGE|SEND_IMAGES
  (WhatsApp), NOTIFY_TEAM, TRACK_EVENT, ESCALATE
- Executor: apps/backend/src/agent/engine.ts executeCommand() processes command
  array
- Pure data objects, backend has NO business logic

DEV_COMMANDS:

- bun install
- bun run dev:backend
- bun run dev:frontend
- bun run dev:notifier
- cd apps/backend && bun run seed

ADD_STATE:

- Frontend UI work (components, forms, interactions, accessibility): Read
  interface-guidelines.md and svelte-frontend-patterns.md
- Bot/backend work (state machine, conversation flow, eligibility rules,
  provider APIs): Read bot-architecture.md
- SvelteKit routing, SSR, load functions, form actions: Read
  svelte-frontend-patterns.md
- WhatsApp integration, webhook handling, command execution: Read
  bot-architecture.md
