# Eligibility

The bot sells on credit that Cálidda, Lima's natural-gas distributor, extends to
its customers. Before it offers anything, it checks the customer's DNI against
two Cálidda sources and learns whether they qualify, for how much, and under
which program.

These are one business's rules written into code. The providers, the
credentials, the thresholds and the segment names are fixed, and every tenant
shares them. So does the copy: the bot introduces itself as Cálidda for every
tenant. A tenant configures its own catalog, periods and personas, and nothing
else here. Onboarding a business that does not sell on Cálidda credit needs code
changes first.

## The two providers

| Segment | Source                                               | Client                                                                          |
| ------- | ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| FNB     | Cálidda's web API: a login, then a credit-line query | [`fnb-client.ts`](../apps/backend/src/adapters/providers/fnb-client.ts)         |
| GASO    | A public Cálidda Power BI report: four queries       | [`powerbi-client.ts`](../apps/backend/src/adapters/providers/powerbi-client.ts) |

FNB answers with a credit line and a name. Power BI answers with a status, a
name, a balance and an NSE (socio-economic stratum).

The credentials are one Cálidda login (`CALIDDA_BASE_URL`, `CALIDDA_USERNAME`,
`CALIDDA_PASSWORD`) and one Power BI report (`POWERBI_RESOURCE_KEY`,
`POWERBI_REPORT_ID`, `POWERBI_DATASET_ID`, `POWERBI_MODEL_ID`), read from the
environment when a check runs ([`config.ts`](../apps/backend/src/config.ts)). A
missing variable does not stop boot. It makes that provider fail at the first
check.

Timeouts are 10 s for the FNB login, 15 s for the FNB query and 20 s for each
Power BI query ([`config/timeouts.ts`](../apps/backend/src/config/timeouts.ts)).
Nothing is retried. The FNB login token is cached in memory for 3500 s and
shared by every tenant.

## Which answer wins

[`check-eligibility-handler.ts`](../apps/backend/src/domains/eligibility/handlers/check-eligibility-handler.ts)
queries both providers in parallel for every DNI. Then
[`eligibility-strategy.ts`](../apps/backend/src/domains/eligibility/strategy/eligibility-strategy.ts)
picks one answer:

```text
FNB approves                         -> FNB's answer
FNB refused or failed, Power BI
approves                             -> Power BI's answer
both failed                          -> system outage
otherwise                            -> not eligible
```

An FNB approval wins over a Power BI approval, and a Power BI approval wins over
an FNB refusal. When one provider fails and the other refuses, the customer is
not eligible; that is not an outage. A provider "fails" when it throws, times
out, is switched off, or has its circuit breaker open.

## The result

[`mapper.ts`](../apps/backend/src/domains/eligibility/mapper.ts) turns the
winning answer into the `eligibility_result` core reads:

- **Segment.** An approval with an NSE is `gaso`, any other approval is `fnb`.
  FNB never sends an NSE, and a Power BI approval with an empty NSE also becomes
  `fnb`.
- **Catalog.** The tenant's active bundles for that segment. A GASO customer is
  offered only bundles priced at or under their credit. An FNB customer is
  offered bundles above it too.
- **Status.** `eligible`, `not_eligible`, `system_outage`, or `needs_human` when
  the check threw.

The result is written to the conversation's metadata and to the columns `dni`,
`client_name`, `segment`, `credit_line` and `nse`. Which provider answered is
not stored.

## What the customer sees

[`phases/checking-eligibility.ts`](../packages/core/src/conversation/phases/checking-eligibility.ts)
and
[`phases/collecting-age.ts`](../packages/core/src/conversation/phases/collecting-age.ts):

| Result                     | The bot                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------- |
| FNB, credit S/ 100 or more | congratulates them on the amount and lists the product groups they can afford         |
| FNB, credit under S/ 100   | says they do not qualify and closes                                                   |
| GASO                       | asks their age; under 25 it closes, otherwise it lists the categories they can afford |
| not eligible               | offers to try another DNI. After the third DNI that fails, it closes                  |
| system outage              | says nothing. The conversation waits in `waiting_for_recovery`                        |
| the check threw            | sends a holding message and escalates to a person                                     |

The minimum credit is `MIN_CREDIT_THRESHOLD` in
[`fnb-logic.ts`](../packages/core/src/eligibility/fnb-logic.ts). The minimum age
is `MIN_AGE` in `collecting-age.ts`. The age is asked but not stored.

## Outages and recovery

When both providers fail, the backend emits `system_outage_detected`, which
alerts the dev group, and the customer's conversation waits in
`waiting_for_recovery`. No timer retries it. An admin runs the check again for
every waiting conversation in scope:

```sh
curl -X POST -b "session=<token>" https://<frontend>/api/admin/retry-eligibility
```

The dashboard has no button for it. `GET /api/admin/outage-status` counts the
conversations waiting. Both routes are in
[`routes/admin/operations.ts`](../apps/backend/src/routes/admin/operations.ts).
A pinned admin sweeps their tenant, an unpinned platform operator every open
tenant.

When one provider fails and the other answers, the backend emits
`provider_degraded`, which also alerts the dev group.

## The circuit breaker

[`adapters/providers/health.ts`](../apps/backend/src/adapters/providers/health.ts)
blocks a provider for 30 minutes when its error message contains `auth`, `401`
or `403` (or `bloqueado`, for FNB). A blocked provider fails at once without a
request. The breaker lives in the backend's memory, so a restart clears it.
`/health` reports it (see [Operations](./operations.md#health)).

## The kill switches

Two platform settings force a provider to fail for every tenant:
`force_fnb_down` and `force_gaso_down`. A platform operator with no tenant
selected sets them on the settings page, `/dashboard/admin/settings`. A tenant
admin sees them but cannot change them
([`domains/settings/system.ts`](../apps/backend/src/domains/settings/system.ts)).

Forcing both down puts every new check into `waiting_for_recovery`.

## Simulated customers

A simulator conversation created with a persona skips both providers. The
persona's answer is returned as both providers' answer
([`eligibility/shared.ts`](../apps/backend/src/domains/eligibility/shared.ts),
[`domains/personas/index.ts`](../apps/backend/src/domains/personas/index.ts)).
Eight personas are built in and every tenant sees them: FNB with S/ 8000, 3000
and 1200; GASO with S/ 5000, 2500 and 1500; not eligible; and not found. A
tenant can add its own on the Personas page. A simulator conversation without a
persona queries the real providers.

## Looking up a DNI

A platform operator can check a DNI outside any conversation:

```sh
curl -b "session=<token>" https://<frontend>/api/providers/<dni>
```

It runs the same parallel check with no tenant, so no catalog is consulted
([`routes/providers.ts`](../apps/backend/src/routes/providers.ts)). The
dashboard's Proveedores tile, shown to platform operators only, calls it.
