-- Trial classes are paid, so a class needs a price.
--
-- Stored in minor units (cents) as an integer. Money is never a float:
-- 0.1 + 0.2 != 0.3 in IEEE 754, and a booking system that rounds wrongly
-- under load is worse than one that refuses the booking.
--
-- Default of 1500 (= $15.00) applies to the existing seeded rows.
ALTER TABLE trial_classes
  ADD COLUMN price_cents INTEGER NOT NULL DEFAULT 1500;

ALTER TABLE trial_classes
  ADD CONSTRAINT price_not_negative CHECK (price_cents >= 0);
