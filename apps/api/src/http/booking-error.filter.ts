import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { BookingError, BookingErrorCode } from '../domain/booking/errors';

/** The single place that maps a domain error code to an HTTP status. */
const STATUS: Record<BookingErrorCode, HttpStatus> = {
  STUDENT_NOT_FOUND: HttpStatus.NOT_FOUND,
  CLASS_NOT_FOUND: HttpStatus.NOT_FOUND,
  BOOKING_NOT_FOUND: HttpStatus.NOT_FOUND,

  // 409: the request was well-formed but conflicts with current state.
  CLASS_FULL: HttpStatus.CONFLICT,
  ALREADY_CONFIRMED: HttpStatus.CONFLICT,
  INVALID_BOOKING_STATE: HttpStatus.CONFLICT,

  // 422: understood, but this class can never be booked again.
  CLASS_ALREADY_STARTED: HttpStatus.UNPROCESSABLE_ENTITY,

  // 502: our fault or the provider's, not the caller's. Safe to retry.
  PAYMENT_PROVIDER_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
};

@Catch(BookingError)
export class BookingErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(BookingErrorFilter.name);

  catch(error: BookingError, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status = STATUS[error.code] ?? HttpStatus.BAD_REQUEST;
    this.logger.warn(`${error.code}: ${error.message}`);
    res.status(status).json({ error: error.code, message: error.message });
  }
}
