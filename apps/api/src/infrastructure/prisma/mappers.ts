import type {
  Booking as BookingRow,
  TrialClass as TrialClassRow,
} from '@prisma/client';
import { Booking } from '../../domain/booking/booking';
import { BookingStatus } from '../../domain/booking/booking-status';
import { TrialClass } from '../../domain/booking/trial-class';

/**
 * Prisma rows in, domain objects out, so the domain never imports Prisma.
 */
export const toDomainBooking = (row: BookingRow): Booking =>
  Booking.rehydrate({
    id: row.id,
    studentId: row.studentId,
    trialClassId: row.trialClassId,
    status: row.status as BookingStatus,
    confirmedAt: row.confirmedAt,
    refundOwed: row.refundOwed,
    createdAt: row.createdAt,
  });

export const toDomainTrialClass = (row: TrialClassRow): TrialClass =>
  TrialClass.rehydrate({
    id: row.id,
    subject: row.subject,
    title: row.title,
    startsAt: row.startsAt,
    capacity: row.capacity,
    confirmedCount: row.confirmedCount,
    priceCents: row.priceCents,
  });
