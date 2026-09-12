/**
 * Money in minor units. Integer only — a float here is a rounding bug waiting
 * to happen, and a booking system that mis-rounds under load is worse than one
 * that refuses the booking.
 */
export class Money {
  private constructor(readonly cents: number) {}

  static fromCents(cents: number): Money {
    if (!Number.isInteger(cents)) throw new Error(`Money must be whole cents, got ${cents}`);
    if (cents < 0) throw new Error(`Money cannot be negative, got ${cents}`);
    return new Money(cents);
  }

  toString(): string {
    return `$${(this.cents / 100).toFixed(2)}`;
  }
}
