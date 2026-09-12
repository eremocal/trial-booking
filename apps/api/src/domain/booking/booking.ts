import { BookingError } from './errors';
import { BookingStatus, isTerminal } from './booking-status';

/** Booking — every status transition lives here. Illegal transitions throw. */
export class Booking {
  private constructor(
    readonly id: string,
    readonly studentId: string,
    readonly trialClassId: string,
    private _status: BookingStatus,
    private _confirmedAt: Date | null,
    private _refundOwed: boolean,
    readonly createdAt: Date,
  ) {}

  static rehydrate(props: {
    id: string;
    studentId: string;
    trialClassId: string;
    status: BookingStatus;
    confirmedAt: Date | null;
    refundOwed: boolean;
    createdAt: Date;
  }): Booking {
    return new Booking(
      props.id,
      props.studentId,
      props.trialClassId,
      props.status,
      props.confirmedAt,
      props.refundOwed,
      props.createdAt,
    );
  }

  get status(): BookingStatus { return this._status; }
  get confirmedAt(): Date | null { return this._confirmedAt; }
  get refundOwed(): boolean { return this._refundOwed; }

  get isConfirmed(): boolean { return this._status === BookingStatus.Confirmed; }
  get isAwaitingPayment(): boolean { return this._status === BookingStatus.PendingPayment; }

  /** A pending booking holds no seat, so it can always be abandoned. */
  get holdsSeat(): boolean { return this.isConfirmed; }

  private requirePending(action: string): void {
    if (!this.isAwaitingPayment) {
      throw new BookingError(
        'INVALID_BOOKING_STATE',
        `cannot ${action} booking ${this.id}: it is ${this._status}, expected pending_payment`,
      );
    }
  }

  /** Seat granted. */
  confirm(at: Date = new Date()): void {
    this.requirePending('confirm');
    this._status = BookingStatus.Confirmed;
    this._confirmedAt = at;
  }

  /** Card declined. No seat was consumed, so nothing to release. */
  failPayment(): void {
    this.requirePending('fail payment for');
    this._status = BookingStatus.PaymentFailed;
  }

  /** Paid, but the seat went to someone else. A refund is owed until settled. */
  loseSeatRace(): void {
    this.requirePending('lose the seat race for');
    this._status = BookingStatus.SeatUnavailable;
    this._refundOwed = true;
  }

  /**
   * Paid, but this student already holds a seat in the class. Also refundable.
   */
  markDuplicate(): void {
    this.requirePending('mark duplicate');
    this._status = BookingStatus.Cancelled;
    this._refundOwed = true;
  }

  settleRefund(): void {
    this._refundOwed = false;
  }

  /** Cancelling a confirmed booking releases its seat; the caller does that. */
  cancel(): void {
    if (this._status === BookingStatus.Cancelled) return;
    if (isTerminal(this._status) && !this.isConfirmed) {
      throw new BookingError(
        'INVALID_BOOKING_STATE',
        `cannot cancel booking ${this.id}: it is ${this._status}`,
      );
    }
    this._status = BookingStatus.Cancelled;
  }
}
