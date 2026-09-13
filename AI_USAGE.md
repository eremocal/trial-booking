# AI Usage

## Tools

- **Claude Code (Opus 5)**, used throughout as an agent in the terminal that
  writes files and runs commands.
- No other AI tools.

The agent wrote most of the code; my time went into deciding what to build and
checking that what came back was correct.

## What I used it for

- **Scaffolding**: pnpm workspace, Nest and Next skeletons, Docker setup.
- **Schema and migrations**: the Prisma model and the SQL migration holding the
  partial unique index and the capacity `CHECK`.
- **Booking logic**: the `FOR UPDATE` transaction, booking statuses, refunds.
- **Tests**: including the concurrency tests against real Postgres and
  `pnpm prove-the-lock`.
- **Docs**: drafted from the session, then edited.

The design calls were mine: no seat holds, decide the winner at confirmation,
charge before claiming the seat, and enforce the rules in the database. I used
the model to implement those and to challenge them.

## Where AI helped me move faster

**The concurrency tests.** Racing 20 transactions against Postgres needs a lot
of fiddly setup. Having it scaffolded in minutes left time for the question that
mattered: can these tests actually fail?

Removing the `FOR UPDATE` showed the race tests failing, **but the brief's own
A/B scenario still passing**, because it runs step by step and never overlaps. An
implementation with no lock at all would pass that scenario and still overbook
in production. That finding shaped the testing approach, and `pnpm
prove-the-lock` reproduces it on demand.

## Where I disagreed with, corrected, or rejected AI output

**Checks that reported success without running anything.** One verification
script printed `inserted ok` from an unconditional `echo` while the `psql`
command above it never ran. The same problem came back as a `| tail` that hid a
failed Docker build, and a `curl -o /dev/null` that printed "API UP" on an HTTP
500. I rejected these and set a rule: **a check that cannot print FAIL is not a
check.**

**The dev runner.** The agent used `tsx`, which silently broke Nest's
dependency injection (esbuild emits no decorator metadata). Typecheck and tests
passed because the tests never used the DI container. Starting the server
revealed it, and I switched to `ts-node`.

**DDD.** The agent argued against DDD, pointing out that an in-memory aggregate
gives false confidence when the real guarantee is in the database. I kept DDD for
the layering, but took the point: `TrialClass` is always loaded under a row lock,
with a `CHECK` constraint underneath.

## What I would change about my AI workflow

**Run the real app earlier.** Three bugs passed a clean build, typecheck and
green tests: broken dependency injection, a class picker in the UI that could not be clicked,
and an API returning `_status` instead of `status`. Each showed up only with a
real request, a real click or a real response body. Next time I'd add a smoke
test that boots the app in the first phase and run it after every change.

**Set verification rules up front.** An agent is fast enough to repeat a bad
check across a dozen commands before you notice.

## How I verified the final implementation

1. **Database constraints directly** (`test/constraints.spec.ts`): writes that
   bypass the app, confirming Postgres rejects a 5th seat, a duplicate confirmed
   booking and a reused idempotency key, while still allowing a retry after a
   declined card.
2. **Tests against real Postgres**, never a mock.
3. **Sabotage testing**: removed the lock (`pnpm prove-the-lock`) and, separately,
   the idempotency handling and the constraints, and confirmed the tests fail.
4. **HTTP contract tests** asserting on the JSON a client actually receives.
5. **End-to-end demo** over HTTP (`pnpm demo`).
6. **Cold start and fresh clone**: `docker compose down -v`, rebuild, and run
   everything from a fresh clone with only `.env.example` copied to `.env`.
7. **Manual check**: running the race by hand in two tabs.
