import { Inject, Injectable } from '@nestjs/common';
import { Booking } from '../domain/booking/booking';
import { BookingStatus } from '../domain/booking/booking-status';
import { BookingError, notFound } from '../domain/booking/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../domain/booking/ports';

/**
 * Create a pending booking. Reserves NOTHING.
 *
 * Two parents may both hold a pending booking for the same last seat; the
 * winner is decided at confirmation. The capacity check here is advisory — it
 * stops a parent being sent to a payment form for a visibly full class — and is
 * explicitly not the guarantee, because the class can fill between this check
 * and the payment completing.
 */
@Injectable()
export class BookTrialUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(input: { studentId: string; trialClassId: string }): Promise<Booking> {
    const { studentId, trialClassId } = input;

    return this.uow.run(async (repos) => {
      if (!(await repos.students.exists(studentId))) throw notFound('STUDENT', studentId);

      const trialClass = await repos.trialClasses.findById(trialClassId);
      if (!trialClass) throw notFound('CLASS', trialClassId);

      if (trialClass.hasStarted()) {
        throw new BookingError(
          'CLASS_ALREADY_STARTED',
          `class ${trialClassId} has already started`,
        );
      }

      // This student already holds a seat. The partial unique index enforces
      // this at confirmation; catching it here means a clear message instead of
      // taking the parent's card details first.
      const seated = await repos.bookings.findOneBy({
        studentId,
        trialClassId,
        status: BookingStatus.Confirmed,
      });
      if (seated) {
        throw new BookingError(
          'ALREADY_CONFIRMED',
          `student ${studentId} is already confirmed in class ${trialClassId}`,
        );
      }

      if (trialClass.isFull) {
        throw new BookingError('CLASS_FULL', `class ${trialClassId} is full`);
      }

      // Reuse an open attempt rather than a row per page refresh.
      const pending = await repos.bookings.findOneBy({
        studentId,
        trialClassId,
        status: BookingStatus.PendingPayment,
      });
      if (pending) return pending;

      return repos.bookings.create({ studentId, trialClassId });
    });
  }
}
