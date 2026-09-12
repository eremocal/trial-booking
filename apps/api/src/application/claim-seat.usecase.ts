import { Inject, Injectable, Logger } from '@nestjs/common';
import { BookingStatus } from '../domain/booking/booking-status';
import { notFound } from '../domain/booking/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../domain/booking/ports';

export type SeatOutcome =
  | { outcome: 'confirmed'; bookingId: string }
  | { outcome: 'already_confirmed'; bookingId: string }
  | { outcome: 'seat_unavailable'; bookingId: string; refundOwed: boolean }
  | { outcome: 'duplicate'; bookingId: string; refundOwed: boolean };

/**
 * Turn a PAID pending booking into a confirmed one. The last-seat race is
 * decided here and nowhere else.
 *
 * `findByIdForUpdate` takes a row lock on the class, and that lock is the
 * serialization point: two contenders both reach it, one acquires it, the other
 * blocks. Under READ COMMITTED the loser re-reads on acquiring the lock, so the
 * aggregate it rehydrates already shows the seat taken.
 *
 * The aggregate is therefore loaded AFTER the lock, never before. Checking
 * capacity on a copy read earlier is the check-then-act race this design exists
 * to prevent.
 */
@Injectable()
export class ClaimSeatUseCase {
  private readonly logger = new Logger(ClaimSeatUseCase.name);

  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(bookingId: string): Promise<SeatOutcome> {
    return this.uow.run(async (repos) => {
      const booking = await repos.bookings.findById(bookingId);
      if (!booking) throw notFound('BOOKING', bookingId);

      // Idempotent: a replayed request must not claim a second seat.
      if (booking.isConfirmed) {
        return { outcome: 'already_confirmed', bookingId } as const;
      }

      // ---- THE LOCK. Concurrent confirmations queue here, one at a time. ----
      const trialClass = await repos.trialClasses.findByIdForUpdate(booking.trialClassId);
      if (!trialClass) throw notFound('CLASS', booking.trialClassId);

      if (trialClass.isFull) {
        booking.loseSeatRace();
        await repos.bookings.save(booking);
        this.logger.warn(
          `booking ${bookingId} lost the last-seat race for class ${trialClass.id}; refund owed`,
        );
        return { outcome: 'seat_unavailable', bookingId, refundOwed: true } as const;
      }

      // The partial unique index is the real guarantee; this gives the caller a
      // described outcome instead of a raw constraint violation, and flags the
      // refund.
      const alreadySeated = await repos.bookings.findOneBy({
        studentId: booking.studentId,
        trialClassId: booking.trialClassId,
        status: BookingStatus.Confirmed,
      });
      if (alreadySeated) {
        booking.markDuplicate();
        await repos.bookings.save(booking);
        return { outcome: 'duplicate', bookingId, refundOwed: true } as const;
      }

      trialClass.claimSeat();
      booking.confirm();
      await repos.trialClasses.save(trialClass);
      await repos.bookings.save(booking);

      return { outcome: 'confirmed', bookingId } as const;
    });
  }
}
