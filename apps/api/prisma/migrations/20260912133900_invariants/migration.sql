-- ============================================================================
-- Trial class booking — database-enforced invariants
-- ============================================================================
-- These are the two guarantees the system rests on. They are expressed as
-- database constraints rather than application checks, so that they hold even
-- if the service layer has a bug, a migration is half-applied, someone opens
-- psql, or two transactions interleave in an order nobody anticipated.
--
-- Prisma's schema language cannot express either one, so they live here and
-- are applied as a migration of their own.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- INVARIANT 1: at most one CONFIRMED booking per (student, trial class)
-- ----------------------------------------------------------------------------
-- A plain UNIQUE (student_id, trial_class_id) would be wrong: it would stop a
-- parent retrying after a declined payment, which is a legitimate thing to do.
--
-- The partial index constrains only the rows that represent a real seat. A
-- student may accumulate any number of payment_failed / cancelled /
-- seat_unavailable rows for a class, but never two confirmed ones.
--
-- This makes the duplicate-booking requirement a structural impossibility
-- rather than a race between a SELECT and an INSERT.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_confirmed_booking_per_student_class
  ON bookings (student_id, trial_class_id)
  WHERE status = 'confirmed';


-- ----------------------------------------------------------------------------
-- INVARIANT 2: a class can never hold more confirmed students than its capacity
-- ----------------------------------------------------------------------------
-- confirmed_count is incremented in the same transaction that flips a booking
-- to 'confirmed'. The CHECK means that even if that logic were wrong, Postgres
-- refuses to write the 5th seat: the transaction aborts rather than overbooking.
--
-- This is the backstop behind the SELECT ... FOR UPDATE in the confirm path.
-- The row lock is what makes concurrent confirmations correct; this constraint
-- is what makes them SAFE if the lock is ever missing.

ALTER TABLE trial_classes
  DROP CONSTRAINT IF EXISTS capacity_not_exceeded;

ALTER TABLE trial_classes
  ADD CONSTRAINT capacity_not_exceeded
  CHECK (confirmed_count >= 0 AND confirmed_count <= capacity);


-- ----------------------------------------------------------------------------
-- Supporting index for the roster query and the capacity recount.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_bookings_confirmed_roster
  ON bookings (trial_class_id)
  WHERE status = 'confirmed';
