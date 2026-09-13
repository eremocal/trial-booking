# Trial Class Booking

A trial booking system that stays correct when two parents pay for the same last
seat at the same moment.

Trial classes hold **4 students**. The system must never seat a 5th child, never
put a child on the roster after a declined card, and when two parents race for
the last seat, exactly one wins.

---

## Run it

```bash
cp .env.example .env
docker compose up -d --build --wait
```

`.env` holds every setting: database credentials, database names, ports and the
API URL. Nothing else hardcodes them, and compose refuses to start without it.

`docker compose up` starts Postgres, applies migrations, seeds demo data, and
brings up the API and web app. `--wait` returns once every service is healthy.

| | |
| --- | --- |
| Booking UI | http://localhost:3000 |
| Roster (teacher/admin) | http://localhost:3000/admin |
| API | http://localhost:3001 |
| Postgres | `localhost:5434` — a demo database and a separate test database used by `pnpm test` |

These are the values in `.env.example`; credentials and database names are in `.env`.

### See the race by hand

1. Open the UI, pick **Elif Khan** and **Fractions Without Fear** (3/4, last
   seat), and continue to payment. The booking is `pending_payment` and holds no
   seat.
2. In a second tab, do the same for **Ben Santos**.
3. Pay in tab 2 → `confirmed`.
4. Pay in tab 1 → `seat_unavailable`, refunded.

The roster shows 4/4. Or run it scripted: `pnpm db:seed && pnpm demo`.

### Commands

| Command | Does |
| --- | --- |
| `pnpm stack:up` / `stack:down` | Run everything in Docker |
| `pnpm test` | API test suite |
| `pnpm prove-the-lock` | Remove the row lock to prove the race tests can fail |
| `pnpm demo` | Scripted walkthrough over HTTP |
| `pnpm db:seed` | Reset demo data |

### Without Docker

```bash
cp .env.example .env
pnpm install
docker compose up -d db
pnpm db:migrate && pnpm db:seed
pnpm api        # port from API_PORT in .env
pnpm web        # :3000, separate terminal
```

Requires Node 22+ and pnpm 11+.

---

## What I built

- Parent picks a child and an available trial class
- Parent books, then pays through a mock gateway (works / declined / gateway
  error)
- Booking status shown after submission
- Teacher/admin roster, as a page and a JSON API
- A refunds-owed queue: money taken, no seat given

**Not built:** regular enrollment, auth, real payments, emails, waitlists.

---

## Data model

Postgres via Prisma.

```
parents          id, email (unique), name
students         id, parent_id → parents, name, birth_year
trial_classes    id, subject, title, starts_at, capacity (4),
                 confirmed_count, price_cents
bookings         id, student_id, trial_class_id, status, created_at,
                 confirmed_at, refund_owed
payment_attempts id, booking_id, status, amount_cents, provider_ref,
                 idempotency_key (unique), failure_reason, created_at
```

**`confirmed_count`** is a stored count of confirmed bookings. It exists so a
`CHECK` constraint can enforce capacity, since a `CHECK` cannot count rows. Every
status change goes through one use case, and the roster recounts and reports
`counterHealthy` so any drift is visible.

**`refund_owed`** marks bookings where money was taken but no seat was given.

### Booking statuses

| Status | Meaning | Holds a seat? |
| --- | --- | --- |
| `pending_payment` | Created, awaiting payment | **No** |
| `confirmed` | On the roster | Yes |
| `payment_failed` | Card declined; parent may retry | No |
| `seat_unavailable` | **Paid, but the class filled first.** Refund owed | No |
| `cancelled` | Cancelled; frees its seat | No |

## Architecture

```
http/            controllers, DTOs, error → HTTP status
application/     use cases: BookTrial, ClaimSeat, PayForBooking,
                 CancelBooking, RosterQuery
domain/          Booking, TrialClass, Money; no Prisma, Nest or HTTP
infrastructure/  Prisma repositories, UnitOfWork, mock payment gateway
```

Dependencies point inward. `TrialClass` owns the capacity rule, but that alone
would still overbook under concurrency, so it is always loaded under a row lock
with a database constraint underneath.

### Key endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/trial-classes` | Classes with live seat counts |
| `GET` | `/api/parents` | Parents and their children |
| `POST` | `/api/bookings` | Create a `pending_payment` booking |
| `POST` | `/api/bookings/:id/pay` | Charge, then claim the seat |
| `GET` | `/api/bookings/:id` | Booking status |
| `POST` | `/api/bookings/:id/cancel` | Cancel and free the seat |
| `GET` | `/api/admin/trial-classes/:id/roster` | Teacher roster |
| `GET` | `/api/admin/refunds-owed` | Refunds owed |

`CLASS_FULL` and `ALREADY_CONFIRMED` return 409, not found returns 404,
`CLASS_ALREADY_STARTED` returns 422.

---

## Preventing duplicate bookings

```sql
CREATE UNIQUE INDEX uniq_confirmed_booking_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status = 'confirmed';
```

The index is **partial**: a plain unique index would stop a parent retrying after
a declined card. A child can have any number of failed or cancelled bookings for
a class, but never two confirmed ones. The API also checks up front to give a
clear message, but the index is the guarantee.

## Handling payment failure

- **Declined card:** the attempt is recorded, the booking becomes
  `payment_failed`, no seat is taken, and the parent can retry.
- **Gateway error:** we don't know if money moved, so nothing changes. The
  booking stays `pending_payment` and the API returns 502. The idempotency key
  comes from the booking, so a retry can never charge twice.
- **Double-click or replay:** a unique index on `idempotency_key` collapses it
  onto the first attempt.

---

## The last-seat race

### The scenario

One seat left in *Fractions Without Fear* (3 of 4 taken).

| # | Scenario | What the system does | Result |
| --- | --- | --- | --- |
| 1 | User A selects the last seat | Creates a booking that **holds no seat** | `pending_payment` |
| 2 | User B selects the same seat | **Not blocked**; B also reaches payment | `pending_payment` |
| 3 | User B pays first | Locks the class, re-reads capacity, claims seat 4 | `confirmed` |
| 4 | User A pays second | Waits for B's lock, re-reads 4/4, no seat, refund | `seat_unavailable` |

Only one confirmed booking for the last seat, and the loser is refunded.

### Approach

The winner is decided at confirmation, in one transaction that starts with a row
lock:

```sql
BEGIN;
  SELECT capacity, confirmed_count
    FROM trial_classes WHERE id = $1
    FOR UPDATE;                     -- the serialization point

  -- capacity is read only AFTER the lock is held
  IF confirmed_count >= capacity THEN
      mark booking seat_unavailable, refund_owed = true;
      COMMIT; RETURN;
  END IF;

  UPDATE trial_classes SET confirmed_count = confirmed_count + 1 WHERE id = $1;
  UPDATE bookings SET status = 'confirmed' WHERE id = $2;
COMMIT;
```

When two payments arrive together, one gets the lock and the other waits. When
the second gets the lock, it reads the updated count and sees the class is full.
Checking capacity *before* the lock would be a check-then-act race.

Two constraints back this up even if the application code is wrong:

```sql
CHECK (confirmed_count >= 0 AND confirmed_count <= capacity)
CREATE UNIQUE INDEX ... WHERE status = 'confirmed'
```

### Why this approach

The alternative is holding a seat at selection with a timer. It is better UX,
but I rejected it here because:

- It needs a background job to release abandoned holds.
- It still needs the lock, because a hold can expire during payment.
- With 4 seats, a refund is simpler than that extra machinery.

I chose a row lock over `SERIALIZABLE`: both are correct, but serializable makes
the loser fail and retry, while the lock lets it wait and read the real answer.

### Tradeoffs

- **A parent can pay and not get a seat.** Refunded automatically and shown
  clearly in the UI.
- **Confirmations for the same class run one at a time.** Fine at 4 seats; a
  very large class would need a different design.
- **`confirmed_count` could drift** if data is edited outside the service. The
  roster surfaces it through `counterHealthy`.

## Where each check belongs

| Layer | Checks | Why |
| --- | --- | --- |
| **UI** | Disable full classes, require a child and class | Fast feedback only; easy to bypass |
| **API** | Class exists and hasn't started, not already confirmed, payment and refunds | Rules and clear error messages |
| **Database** | Partial unique index, capacity `CHECK`, `FOR UPDATE`, unique idempotency key | The only layer that holds under concurrency |

---

## Verification

| Tests | Check |
| --- | --- |
| Domain | Business rules, no database |
| Concurrency | The race, against real Postgres |
| Constraints | Postgres itself rejects a 5th seat, a duplicate confirmed booking and a reused idempotency key |
| Payment | Declines, retries, idempotency, refunds |
| HTTP contract | Correct JSON and status codes |

Key concurrency tests:

```
✓ the brief scenario: A reaches payment first, B pays first, A pays second
✓ 20 parents paying simultaneously for 1 remaining seat: exactly 1 wins
✓ 20 parents racing for an EMPTY class: exactly 4 win, never 5
✓ two SIMULTANEOUS requests with the same key still charge once
```

**These tests can fail.** `pnpm prove-the-lock` removes the `FOR UPDATE`, runs
the suite, and restores it. Without the lock, the concurrency tests fail.

Notably, **the brief's own scenario still passes without the lock**, because it
runs step by step and nothing overlaps. Only the truly concurrent tests catch the
bug.

### Seed data

`pnpm db:seed` loads demo data and checks that every class's `confirmed_count`
matches its confirmed bookings.

| Class | State | Demonstrates |
| --- | --- | --- |
| Why Volcanoes Erupt | 0/4 | Available seats |
| Fractions Without Fear | **3/4** | The last-seat race |
| Building Simple Circuits | 4/4 | Full class |

It also includes a duplicate attempt (Ana Santos: confirmed + cancelled in
Fractions) and a payment failure (Ben Santos: declined card for Volcanoes).

---

## Assumptions

- A pending booking holds no seat.
- Cancelling a confirmed booking frees the seat.
- One confirmed trial per child per class; retry after a decline is allowed.
- Trials cost $15, stored as integer cents.
- No authentication.
- Refunds are assumed to succeed; `refund_owed` is where retries would hook in.
- Works across multiple API instances, because the lock is in Postgres.

## What I would monitor after release

Payments are mocked here. The first three apply to this system as built; the
last two assume a real payment provider replaces the mock.

1. **Seat counter drift:** `confirmed_count` vs. actual confirmed bookings
   (already reported as `counterHealthy` on the roster).
2. **Pay-but-no-seat rate:** how often a parent pays and loses the last seat.
3. **Lock wait time** on payment confirmation.
4. **Refunds owed:** how many, and how old. With the mock, refunds always
   succeed instantly.
5. **Payment provider errors**, tracked separately from normal card declines.

## What I would do next with more time

1. A background worker to retry refunds that fail.
2. Seat holds with a timer, if many parents pay and lose the seat.
3. Waitlists for parents who lose the race.
4. Authentication, so parents can only book for their own children.
