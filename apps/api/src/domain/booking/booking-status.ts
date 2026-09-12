/**
 * The lifecycle of a trial booking. The same names are used by the API, the
 * database column and the UI.
 */
export const BookingStatus = {
  /** Created, awaiting a payment result. Holds NO seat. */
  PendingPayment: 'pending_payment',
  /** On the roster. Occupies exactly one seat. */
  Confirmed: 'confirmed',
  /** Card declined. No seat consumed; the parent may retry. */
  PaymentFailed: 'payment_failed',
  /**
   * Payment SUCCEEDED but the last seat went to someone else.
   * A refund is owed. This is the losing side of the last-seat race.
   */
  SeatUnavailable: 'seat_unavailable',
  /** Cancelled by parent or admin. Releases its seat. */
  Cancelled: 'cancelled',
} as const;

export type BookingStatus = (typeof BookingStatus)[keyof typeof BookingStatus];

/** Only a confirmed booking occupies a seat. */
export function occupiesSeat(status: BookingStatus): boolean {
  return status === BookingStatus.Confirmed;
}

export function isTerminal(status: BookingStatus): boolean {
  return status !== BookingStatus.PendingPayment;
}
