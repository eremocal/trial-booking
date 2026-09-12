export type BookingErrorCode =
  | 'STUDENT_NOT_FOUND'
  | 'CLASS_NOT_FOUND'
  | 'BOOKING_NOT_FOUND'
  | 'CLASS_ALREADY_STARTED'
  | 'ALREADY_CONFIRMED'
  | 'CLASS_FULL'
  | 'INVALID_BOOKING_STATE'
  | 'PAYMENT_PROVIDER_UNAVAILABLE';

/**
 * Domain errors carry a code, never an HTTP status. BookingErrorFilter maps
 * codes to status at the HTTP edge.
 */
export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BookingError';
  }
}

export const notFound = (what: 'STUDENT' | 'CLASS' | 'BOOKING', id: string) =>
  new BookingError(
    `${what}_NOT_FOUND` as BookingErrorCode,
    `${what.toLowerCase()} ${id} not found`,
  );
