import { Inject, Injectable } from '@nestjs/common';
import { notFound } from '../domain/booking/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../domain/booking/ports';

/**
 * Cancel a booking. A confirmed booking returns its seat to the pool in the
 * same transaction, so capacity accounting cannot drift.
 */
@Injectable()
export class CancelBookingUseCase {
  constructor(@Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork) {}

  async execute(bookingId: string) {
    return this.uow.run(async (repos) => {
      const booking = await repos.bookings.findById(bookingId);
      if (!booking) throw notFound('BOOKING', bookingId);

      const heldSeat = booking.holdsSeat;
      booking.cancel();

      if (heldSeat) {
        const trialClass = await repos.trialClasses.findByIdForUpdate(booking.trialClassId);
        if (!trialClass) throw notFound('CLASS', booking.trialClassId);
        trialClass.releaseSeat();
        await repos.trialClasses.save(trialClass);
      }

      await repos.bookings.save(booking);
      return booking;
    });
  }
}
