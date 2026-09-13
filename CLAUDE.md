# Working in this repo

A trial-class booking system. The hard part is concurrency, not features:
a class holds 4 students and two parents may pay for the last seat at once.

## Layering

Dependencies point inward. `domain/` imports nothing from the other layers.

```
http/            controllers, DTOs, domain-error -> HTTP status
application/     use cases; orchestrate, hold no rules
domain/          entities, value objects, ports. No Prisma, no Nest, no HTTP
infrastructure/  Prisma repositories, UnitOfWork, payment gateway adapter
```

`app.module.ts` is the composition root and the only file that knows which
adapter satisfies which port.

## Conventions that matter here

**Invariants live in SQL as well as in the aggregate.** `TrialClass.claimSeat()`
refuses to overbook, and that is necessary but NOT sufficient: two transactions
can each load the aggregate, each see a free seat, and each commit. The real
guarantees are a partial unique index and a `CHECK` constraint in
`prisma/migrations/20260912133900_invariants/migration.sql`, tested directly in
`test/constraints.spec.ts`. If you add an invariant, add it as a constraint and a
test there too.

**Capacity is read after the lock, never before.** `ClaimSeatUseCase` loads the
class through `TrialClassRepository.findByIdForUpdate`, which issues
`SELECT ... FOR UPDATE`. Loading the aggregate first and checking `isFull` on a
stale copy is the check-then-act race this design exists to prevent.

**Seat transitions go through the aggregate and one use case.**
`confirmed_count` is denormalised, so a status written anywhere else drifts from
the booking rows. `RosterQuery` recounts and reports `counterHealthy` so drift
surfaces rather than hides.

**Reads bypass the domain deliberately.** `RosterQuery` talks to Prisma
directly. Reads protect no invariants, and rehydrating aggregates to render a
table buys only indirection.

**Tests: domain pure, concurrency real.** `test/domain.spec.ts` runs with no
database in milliseconds. Anything about timing or contention must be tested
against real Postgres — mocking it there tests nothing. The suite runs against
the test database (`POSTGRES_TEST_DB`) in the same container as the demo data,
and truncates between cases, so never point it at the demo database
(`POSTGRES_DB`).

**A test that cannot fail is not a test.** `pnpm prove-the-lock` removes the row
lock and shows 3 concurrency tests failing while all 16 domain tests still pass.
Add concurrency tests the same way: break the implementation, confirm the test
catches it.

**Domain errors carry codes, not HTTP status.** `BookingError` + a code;
`BookingErrorFilter` maps to status at the edge.

**Money is integer minor units.** `Money.fromCents` rejects fractions.

## Running things

`pnpm stack:up` (everything in Docker, waits until healthy) or `pnpm api` /
`pnpm web` locally. Not `pnpm up` -- that is pnpm's dependency updater.
`pnpm test` for the API suite, `pnpm demo` for the HTTP walkthrough. Copy
`.env.example` to `.env` first: every setting lives there and nothing else
hardcodes credentials, database names or ports.

See README.md for the full design rationale.
