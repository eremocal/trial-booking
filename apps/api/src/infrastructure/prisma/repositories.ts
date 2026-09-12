import { Prisma } from '@prisma/client';
import { Booking } from '../../domain/booking/booking';
import { BookingStatus } from '../../domain/booking/booking-status';
import { TrialClass } from '../../domain/booking/trial-class';
import type {
  BookingRepository,
  PaymentAttemptRepository,
  StudentRepository,
  TrialClassRepository,
} from '../../domain/booking/ports';
import { toDomainBooking, toDomainTrialClass } from './mappers';

/** Everything here runs on a transaction client, never the bare PrismaClient. */
type Tx = Prisma.TransactionClient;

export class PrismaTrialClassRepository implements TrialClassRepository {
  constructor(private readonly tx: Tx) {}

  async findById(id: string): Promise<TrialClass | null> {
    const row = await this.tx.trialClass.findUnique({ where: { id } });
    return row ? toDomainTrialClass(row) : null;
  }

  /**
   * SELECT ... FOR UPDATE. The lock is held until the surrounding transaction
   * ends, which is what serialises concurrent seat claims.
   *
   * The raw query takes the lock; the aggregate is then rehydrated from the
   * freshly-read row, so the domain object can never be built from a stale copy.
   */
  async findByIdForUpdate(id: string): Promise<TrialClass | null> {
    const locked = await this.tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM trial_classes WHERE id = ${id} FOR UPDATE
    `;
    if (locked.length === 0) return null;
    return this.findById(id);
  }

  async save(trialClass: TrialClass): Promise<void> {
    await this.tx.trialClass.update({
      where: { id: trialClass.id },
      data: { confirmedCount: trialClass.confirmedCount },
    });
  }
}

export class PrismaBookingRepository implements BookingRepository {
  constructor(private readonly tx: Tx) {}

  async findById(id: string): Promise<Booking | null> {
    const row = await this.tx.booking.findUnique({ where: { id } });
    return row ? toDomainBooking(row) : null;
  }

  async findOneBy(criteria: {
    studentId: string;
    trialClassId: string;
    status: BookingStatus;
  }): Promise<Booking | null> {
    const row = await this.tx.booking.findFirst({
      where: criteria,
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomainBooking(row) : null;
  }

  async create(input: { studentId: string; trialClassId: string }): Promise<Booking> {
    const row = await this.tx.booking.create({
      data: { ...input, status: BookingStatus.PendingPayment },
    });
    return toDomainBooking(row);
  }

  async save(booking: Booking): Promise<void> {
    await this.tx.booking.update({
      where: { id: booking.id },
      data: {
        status: booking.status,
        confirmedAt: booking.confirmedAt,
        refundOwed: booking.refundOwed,
      },
    });
  }
}

export class PrismaStudentRepository implements StudentRepository {
  constructor(private readonly tx: Tx) {}

  async exists(id: string): Promise<boolean> {
    return (await this.tx.student.count({ where: { id } })) > 0;
  }
}

export class PrismaPaymentAttemptRepository implements PaymentAttemptRepository {
  constructor(private readonly tx: Tx) {}

  async findByIdempotencyKey(key: string) {
    const row = await this.tx.paymentAttempt.findUnique({ where: { idempotencyKey: key } });
    if (!row) return null;
    return {
      bookingId: row.bookingId,
      status: row.status as 'succeeded' | 'failed',
      failureReason: row.failureReason,
    };
  }

  async record(input: {
    bookingId: string;
    status: 'succeeded' | 'failed';
    amountCents: number;
    providerRef: string;
    idempotencyKey: string;
    failureReason?: string;
  }): Promise<void> {
    await this.tx.paymentAttempt.create({ data: input });
  }
}
