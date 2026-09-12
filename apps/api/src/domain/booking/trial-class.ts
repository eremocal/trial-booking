import { Money } from '../shared/money';
import { BookingError } from './errors';

/**
 * TrialClass — aggregate root for seating; capacity is its invariant.
 *
 * Enforcing capacity here is necessary but not sufficient: two transactions
 * can each load this object, each see a free seat, and each commit. So it is
 * always loaded under a row lock (`TrialClassRepository.findByIdForUpdate`)
 * with a CHECK constraint underneath.
 */
export class TrialClass {
  private constructor(
    readonly id: string,
    readonly subject: string,
    readonly title: string,
    readonly startsAt: Date,
    readonly capacity: number,
    private _confirmedCount: number,
    readonly price: Money,
  ) {}

  static rehydrate(props: {
    id: string;
    subject: string;
    title: string;
    startsAt: Date;
    capacity: number;
    confirmedCount: number;
    priceCents: number;
  }): TrialClass {
    return new TrialClass(
      props.id,
      props.subject,
      props.title,
      props.startsAt,
      props.capacity,
      props.confirmedCount,
      Money.fromCents(props.priceCents),
    );
  }

  get confirmedCount(): number {
    return this._confirmedCount;
  }

  get seatsRemaining(): number {
    return this.capacity - this._confirmedCount;
  }

  get isFull(): boolean {
    return this.seatsRemaining <= 0;
  }

  /** True once the class has started; bookings are refused from that point. */
  hasStarted(now: Date = new Date()): boolean {
    return this.startsAt.getTime() <= now.getTime();
  }

  /**
   * Take one seat. Throws rather than returning false, because calling this on
   * a full class is a programming error: callers are expected to have checked
   * `isFull` while holding the lock.
   */
  claimSeat(): void {
    if (this.isFull) {
      throw new BookingError('CLASS_FULL', `class ${this.id} is full`);
    }
    this._confirmedCount += 1;
  }

  /** Give a seat back, on cancellation. */
  releaseSeat(): void {
    if (this._confirmedCount === 0) {
      throw new Error(`cannot release a seat from empty class ${this.id}`);
    }
    this._confirmedCount -= 1;
  }
}
