# How a conversation runs

A customer's WhatsApp message becomes a reply in one bot turn. This document
follows the message from Meta's webhook to the reply on the customer's phone,
then describes the phases a conversation moves through and how a person takes it
over.

```text
webhook -> message_inbox -> aggregator -> lock -> turn
  turn:  idle reset -> mark read -> enrichment loop (core transition) ->
         pacing delay -> execute commands (send, persist) -> emit events
  send failure -> outbox -> outbox worker -> handoff to a person
```

## The webhook

Meta posts a signed batch to the frontend at `/api/webhook`, which relays it to
the backend and returns the backend's verdict. How the endpoint is set up and
secured is in [Connecting WhatsApp](./whatsapp.md).

[`routes/webhook.ts`](../apps/backend/src/routes/webhook.ts) handles each
message in the batch on its own and reports a status for it in the 200 body:

| Status                                 | Meaning                                                                        |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `received`                             | Stored in `message_inbox` for the aggregator.                                  |
| `maintenance_held`                     | Stored in `held_messages`. See [Operations](./operations.md#maintenance-mode). |
| `duplicate`                            | Its Meta message id is already queued or held. Nothing is done.                |
| `non_text_ignored`                     | Image, audio, video, document or unknown type. No reply, nothing stored.       |
| `ignored_system_message`               | No sender.                                                                     |
| `unroutable_no_phone_number_id`        | The change carries no `metadata.phone_number_id`. Dropped.                     |
| `unknown_channel_account`              | No channel account has that id. Dropped.                                       |
| `channel_account_pending`, `_disabled` | The number is not active. Dropped.                                             |
| `tenant_not_active`                    | The business is suspended. Dropped.                                            |
| `no_message`                           | The change carried no message, such as a delivery status. Ignored.             |

A dropped message is gone: Meta got a 200 and does not redeliver it. A message
that throws while being stored makes the whole batch answer 500, so Meta
redelivers it, and the message id check skips the ones already stored.

Before storing a text message, the webhook creates the conversation if needed
and writes the inbound `messages` row. The dashboard shows it from there.

The backend ignores Meta's delivery and read statuses. A reply's `sent` status
means Meta accepted it, not that it was delivered.

## The inbox and the aggregator

[`conversation/aggregator-worker.ts`](../apps/backend/src/conversation/aggregator-worker.ts)
polls `message_inbox` every 100 ms. It takes every `pending` row older than 2 s,
groups them by conversation, and joins each group's text with spaces into one
message. The 2 s is an age per row, not a pause since the customer's last
message: two messages 1.5 s apart can be answered in two turns.

Rows of a suspended tenant or an inactive number are skipped and stay `pending`
([`message-inbox.ts`](../apps/backend/src/conversation/message-inbox.ts)). All
ready groups run in parallel. Each row moves:

```text
pending -> processing -> processed    the turn returned
                      -> pending      the lock was busy, or the number was
                                      switched off during the turn
                      -> failed       the turn threw before working out a reply
```

A turn that fails while working out a reply is caught inside the turn, so its
rows still end `processed` and the customer gets no reply. Nothing retries a
`failed` row. A backend that dies mid-turn leaves its rows `processing`, and
nothing answers them again.

Processed rows are kept 7 days, because the Meta message id on them is what
recognizes a redelivery
([`processed-retention.ts`](../apps/backend/src/conversation/processed-retention.ts)).

## The lock

Every turn, takeover, release and outbox attempt runs inside the conversation's
lock ([`conversation/locks.ts`](../apps/backend/src/conversation/locks.ts)). The
key is `tenant:channel account:phone`, so the same contact writing to two
numbers has two conversations. Waiters queue in order. The lock lives in the
backend's memory, which is one reason the backend is
[one process](../architecture.md#where-state-lives).

The limit is 30 s and counts the wait. A caller that never got the lock gets
`ConversationBusyError`: nothing ran, and its inbox rows go back to `pending`. A
caller whose work outlives the limit gets `LockTimeoutError`: the work keeps
running and keeps the lock, and its rows stay `processing` until it settles.

A manual message from an agent does not take the lock.

## The turn

[`handler/orchestrator.ts`](../apps/backend/src/conversation/handler/orchestrator.ts)
runs one turn for one grouped message:

1. Load the conversation. If it has been idle 3 hours, reset it (see
   [the idle reset](#the-idle-reset)).
2. Mark the message read and show the typing indicator.
3. Run the enrichment loop, which calls core until it has a final result.
4. Wait out the rest of the pacing delay: `BOT_RESPONSE_DELAY_MS`, default 2300
   ms, counted from the customer's message. A message older than 10 minutes gets
   no delay.
5. Execute the commands.
6. Emit the transition's events, then `escalation_triggered` if the new phase is
   `escalated`.

The simulator and the maintenance sweep call the same `handleMessage`.

## Core's transition

[`transition()`](../packages/core/src/conversation/transition.ts) dispatches to
one function per phase in
[`phases/`](../packages/core/src/conversation/phases/). Its contract is in
[`types.ts`](../packages/core/src/conversation/types.ts):

```ts
transition({ phase, message, metadata, enrichment?, quotedContext?, context? })
  => { type: "update", nextPhase, commands, events? }
   | { type: "need_enrichment", enrichment, pendingPhase?, events? }
```

It matches the message with regexes and keyword lists
([`validation/`](../packages/core/src/validation/),
[`matching/`](../packages/core/src/matching/)) and picks copy from
[`templates/`](../packages/core/src/templates/). It performs no I/O. It is not
deterministic: copy variants are chosen at random.

The commands:

| Command                                      | What the executor does                                                                                                      |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `SEND_MESSAGE { text }`                      | Sends one text. Consecutive texts are 1 s apart.                                                                            |
| `SEND_IMAGES { category?, offset?, query? }` | Sends up to 3 of the tenant's active, in-stock bundles, cheapest first, as images with captions, then a follow-up question. |
| `SEND_BUNDLE { bundleId }`                   | Sends one bundle's image. No phase produces it.                                                                             |
| `TRACK_EVENT { event, metadata? }`           | Writes an `analytics_events` row after the sends.                                                                           |

## The enrichment loop

When core needs something it cannot compute, it returns `need_enrichment`.
[`handler/enrichment-loop.ts`](../apps/backend/src/conversation/handler/enrichment-loop.ts)
runs the matching handler from
[`conversation/enrichment/handlers/`](../apps/backend/src/conversation/enrichment/handlers/),
folds the result into metadata, and calls core again with it.

Core requests five kinds:

| Request                    | Handler calls                                      |
| -------------------------- | -------------------------------------------------- |
| `check_eligibility`        | FNB and GASO. See [Eligibility](./eligibility.md). |
| `detect_question`          | The LLM: is this a question?                       |
| `should_escalate`          | The LLM: does this need a person?                  |
| `answer_question`          | The LLM: answer it from the catalog.               |
| `recover_unclear_response` | The LLM: a reply that asks again.                  |

Three more are registered and never requested. The LLM is OpenAI
`gpt-5-nano-2025-08-07`, set in
[`packages/intelligence/src/config.ts`](../packages/intelligence/src/config.ts).
No environment variable switches it off or to a mock.

A `pendingPhase` is written to the database before its handler runs, so a
customer mid-eligibility-check shows `checking_eligibility` in the dashboard.

The loop stops after 10 rounds and escalates with reason
`enrichment_loop_exceeded`. A handler that throws ends the turn: no reply, the
error is logged as "Message processing failed", and a `system_error_occurred`
alert goes to the dev group. With no `OPENAI_API_KEY`, every message the regexes
do not recognize ends this way.

## The executor

[`handler/command-executor.ts`](../apps/backend/src/conversation/handler/command-executor.ts)
runs the commands in order, then writes the new phase if it changed, then the
analytics rows.

A simulated conversation (`is_simulation = 1`) writes each reply to `messages`
as `sent` and sends nothing.

The phase is written whatever the sends returned. A reply that failed for good
is logged and the conversation moves on. An image that was neither sent nor
queued is not recorded as shown. If a send throws `ChannelUnavailableError` (the
number was switched off mid-turn), nothing after it runs, the phase is not
written, and the inbox rows go back to `pending`. The retry replays the turn
from the old phase, and a message sent before the throw goes out again.

## The send

Every reply goes through `WhatsAppService` in
[`adapters/whatsapp/index.ts`](../apps/backend/src/adapters/whatsapp/index.ts).
The adapter is chosen at import: `NODE_ENV=development` sends through the
notifier, anything else through the Cloud API
([`cloud-api.ts`](../apps/backend/src/adapters/whatsapp/cloud-api.ts), Graph
`v17.0`, 10 s for text, 15 s for an image). An image is sent as a link to
`<public url>/media/images/<id>.jpg`, which Meta fetches.

A bot reply:

1. If the conversation still owes an earlier reply, queues behind it: the reply
   is written to `messages` as `queued` and appended to the outbox with no
   attempt, so replies go out in the order the bot produced them. Otherwise it
   continues.
2. Re-reads the channel account. A missing account, a suspended tenant, or an
   account of another tenant is a `permanent` failure. A `pending` or `disabled`
   account throws `ChannelUnavailableError`.
3. Sends, and gets back a typed outcome
   ([`types.ts`](../apps/backend/src/adapters/whatsapp/types.ts)):

| Outcome     | When                                                                          | Retried         |
| ----------- | ----------------------------------------------------------------------------- | --------------- |
| `ok`        | Meta returned a message id                                                    | no              |
| `transient` | HTTP 429 or 5xx; Meta codes 130429, 131056; connection refused; DNS failure   | yes             |
| `ambiguous` | timeout; other network error; 2xx without a message id. It may have gone out. | once, after 5 s |
| `permanent` | any other 4xx; no usable token; account refused                               | no              |

On `ok` the `messages` row is `sent` with Meta's id. Any other outcome of an
attempt goes on the outbox. A `permanent` one lands there already `failed`,
which starts [the handoff](#the-handoff). The rest are written `queued` and
retried. A refusal in step 2 is written `failed` and goes nowhere else.

An agent's manual reply takes none of this. It is sent once, and the agent sees
the failure in the dashboard.

## The outbox

The `outbox` table holds a reply that may still go out. Its states and budget
are in [`conversation/outbox.ts`](../apps/backend/src/conversation/outbox.ts):

```text
pending  -> sending -> sent
                    -> failed      permanent, out of budget, second ambiguous
                    -> pending     transient: retry after 5 s, 30 s, 2 min, 10 min
pending  -> failed    older than 1 hour ("expired")
pending  -> cancelled a person took the conversation
```

A reply gets at most 5 attempts, the inline send counting as the first.

[`outbox-worker.ts`](../apps/backend/src/conversation/outbox-worker.ts) polls
every second. For each conversation with a due row it takes the lock, expires
rows past an hour, claims only the lowest-numbered row, sends it, and records
the outcome on the outbox and `messages` rows in one transaction. A number
switched off defers the row 60 s without counting an attempt. At boot, a row
left `sending` is recorded as one `ambiguous` attempt with reason `interrupted`.

Final rows are deleted after 7 days.

## The handoff

A `failed` row means the customer did not get a reply.
[`outbox-handoff.ts`](../apps/backend/src/conversation/outbox-handoff.ts) runs
after every outbox pass and finds conversations with a `failed` row not yet
handed off. Inside the lock it:

1. cancels the conversation's pending replies,
2. escalates the conversation with reason `reply_undeliverable` if it is still
   `active`,
3. emits `escalation_triggered`,
4. stamps `handed_off_at` on the failed rows.

A crash between steps 3 and 4 alerts twice. The customer is not told anything.

## Phases

A conversation is in one of 12 phases, stored as `context_data.phase`. Most
conversations run:

```text
greeting -> confirming_client -> collecting_dni -> checking_eligibility
  -> (gaso) collecting_age
  -> offering_products <-> handling_objection
  -> confirming_selection -> closing
```

| Phase                  | Waits for                                            | Moves to                                                                                                    |
| ---------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `greeting`             | any message                                          | `confirming_client`, after the greeting                                                                     |
| `confirming_client`    | yes, no, or a DNI                                    | `collecting_dni`; `closing` on no; `checking_eligibility` on a DNI                                          |
| `collecting_dni`       | an 8-digit DNI                                       | `checking_eligibility`                                                                                      |
| `checking_eligibility` | the provider result                                  | `offering_products`, `collecting_age`, `offering_dni_retry`, `closing`, `waiting_for_recovery`, `escalated` |
| `offering_dni_retry`   | yes or no                                            | `collecting_dni`, `closing`                                                                                 |
| `collecting_age`       | an age                                               | `offering_products`; `closing` below 25                                                                     |
| `offering_products`    | a category, a product, a question, a price complaint | `confirming_selection`, `handling_objection`, `closing`, `escalated`                                        |
| `handling_objection`   | a reply to the objection                             | `offering_products`; `escalated` after a second rejection, or on a question for a person                    |
| `confirming_selection` | yes or no                                            | `closing` with a confirmed purchase; `offering_products`                                                    |
| `closing`              | anything                                             | answers questions; `offering_products` on a new purchase intent                                             |
| `escalated`            | nothing: the bot stays silent                        | `greeting` on release or the idle reset                                                                     |
| `waiting_for_recovery` | an operator's eligibility retry                      | the result of the retry, or `greeting` on the idle reset                                                    |

A confirmed selection emits `purchase_confirmed`, which creates an order with
quantity 1 and address "Pendiente de coordinación"
([`bootstrap/event-bus-setup.ts`](../apps/backend/src/bootstrap/event-bus-setup.ts)),
and tells the customer a colleague will call. The bot does not close the sale.

`escalated` and `waiting_for_recovery` are terminal inside core. While a
conversation is `escalated`, the bot still runs a turn for each message, marks
it read, and sends nothing.

## The idle reset

At the start of a turn, a conversation whose `metadata.lastActivityAt` is 3
hours or more in the past is reset to `greeting`
([`store.ts`](../apps/backend/src/conversation/store.ts)). The reset clears the
metadata except the last category, sets `status` back to `active` and clears the
handover reason. It happens only when the customer writes again.

`lastActivityAt` moves when the phase is written and when an agent sends a
manual message. It does not move on every customer message, so a customer whose
phase has not changed in 3 hours is reset even mid-conversation. A conversation
a person took over is reset too, once 3 hours pass without a manual message.

## Escalation

The bot escalates when:

- the customer turns down the offer again after a price objection
  (`multiple_objections`),
- the LLM says a question needs a person (`customer_question_requires_human`,
  `customer_question_during_objection`),
- the eligibility check throws (`eligibility_check_error`),
- the enrichment loop runs out (`enrichment_loop_exceeded`),
- a reply cannot be delivered (`reply_undeliverable`).

Escalating sets the phase to `escalated`, `conversations.status` to
`human_takeover` and `handover_reason` to the reason, and emits
`escalation_triggered`. Only the eligibility escalation sends the customer a
holding message. The others send nothing.

The alert goes to the conversation's assigned agent if it has one, else to the
tenant's sales target: the `whatsapp_group_sales` tenant setting, else
`WHATSAPP_GROUP_AGENT`
([`notifications/resolver.ts`](../apps/backend/src/domains/notifications/resolver.ts)).
Nothing assigns an agent when a conversation escalates. The escalation alerts
the sales target and picks nobody.

An agent becomes assigned by saving agent data on the conversation
(`PATCH /api/conversations/:phone/agent-data`). The round-robin in
[`conversations/assignment.ts`](../apps/backend/src/domains/conversations/assignment.ts)
runs only when an assigned agent declines the conversation. After that, a timer
passes the conversation to the next available sales agent every 5 minutes until
someone takes it over.

## Takeover and release

An agent takes a conversation from the dashboard:

- **Takeover** (`POST /api/conversations/:phone/takeover`) sets the phase to
  `escalated` with reason "Manual takeover by agent" and cancels the replies the
  bot still owed. A turn already running may still send what it had ready.
- **Manual message** (`POST /api/conversations/:phone/message`) sends once and
  moves `lastActivityAt`. It works whether or not the bot is silenced.
- **Release** (`POST /api/conversations/:phone/release`) resets a taken-over
  conversation to `greeting`, as the idle reset does. The customer's next
  message starts over.

These are in
[`domains/conversations/write.ts`](../apps/backend/src/domains/conversations/write.ts).
