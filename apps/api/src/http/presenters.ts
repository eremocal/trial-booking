import type { Booking } from '../domain/booking/booking';

/**
 * Domain entity -> HTTP response. Entities keep state in private fields, so
 * serialising one directly would emit `_status` instead of `status`.
 */
export function bookingResponse(booking: Booking) {
  return {
    id: booking.id,
    studentId: booking.studentId,
    trialClassId: booking.trialClassId,
    status: booking.status,
    confirmedAt: booking.confirmedAt,
    refundOwed: booking.refundOwed,
    createdAt: booking.createdAt,
  };
}
