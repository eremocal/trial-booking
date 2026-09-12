import { Inject, Injectable, Logger } from '@nestjs/common';
import { BookingStatus } from '../domain/booking/booking-status';
import { BookingError, notFound } from '../domain/booking/errors';
import { UNIT_OF_WORK, UnitOfWork } from '../domain/booking/ports';
import { PAYMENT_GATEWAY, PaymentGateway } from '../domain/payment/ports';
import { ClaimSeatUseCase, SeatOutcome } from './claim-seat.usecase';

export type PayResult = {
  bookingId: string;
  status: BookingStatus;
  payment: 'succeeded' | 'failed';
  seat?: SeatOutcome['outcome'];
  failureReason?: string;
  refunded?: boolean;
  replayed?: boolean;
};

/**
 * Pay for a pending booking, then try to claim the seat.
 *
 * Money moves BEFORE the seat is claimed. Claiming first means a gateway
 * timeout strands a seat nobody paid for, needing a reaper job; charging first
 * means the bad case is "paid but no seat", recoverable by refund and visible
 * as seat_unavailable + refund_owed. A rare refund beats a blocked seat.
 *
 * The gateway call sits outside any transaction: never hold one open across a
 * third-party network call.
 */
@Injectable()
export class PayForBookingUseCase {
  private readonly logger = new Logger(PayForBookingUseCase.name);

  constructor(
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWork,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly claimSeat: ClaimSeatUseCase,
  ) {}

  async execute(input: {
    bookingId: string;
    idempotencyKey: string;
    token: string;
  }): Promise<PayResult> {
    const { bookingId, idempotencyKey, token } = input;

    // ---- 1. Replay? --------------------------------------------------------
    const prior = await this.uow.run((repos) =>
      repos.payments.findByIdempotencyKey(idempotencyKey),
    );
    if (prior) {
      const booking = await this.uow.run((r) => r.bookings.findById(prior.bookingId));
      this.logger.log(`replayed payment attempt ${idempotencyKey}`);
      return {
        bookingId: prior.bookingId,
        status: booking?.status ?? BookingStatus.PendingPayment,
        payment: prior.status,
        failureReason: prior.failureReason ?? undefined,
        replayed: true,
      };
    }

    // ---- 2. Is this booking payable? ---------------------------------------
    const { booking, amountCents } = await this.uow.run(async (repos) => {
      const b = await repos.bookings.findById(bookingId);
      if (!b) throw notFound('BOOKING', bookingId);
      const c = await repos.trialClasses.findById(b.trialClassId);
      if (!c) throw notFound('CLASS', b.trialClassId);
      return { booking: b, amountCents: c.price.cents };
    });

    if (booking.isConfirmed) {
      return {
        bookingId,
        status: booking.status,
        payment: 'succeeded',
        seat: 'already_confirmed',
      };
    }
    if (!booking.isAwaitingPayment) {
      throw new BookingError(
        'INVALID_BOOKING_STATE',
        `booking ${bookingId} is ${booking.status} and cannot be paid for`,
      );
    }

    // ---- 3. Charge ---------------------------------------------------------
    //
    // A provider can fail in two different ways, and they are not the same
    // thing. A DECLINE is an answer: no money moved, and the booking is
    // terminal. A THROW is the absence of an answer -- the request may have
    // been processed, may not; we genuinely do not know.
    //
    // For the unknown case the only honest move is to change nothing. The
    // booking stays pending_payment and no payment_attempt is written, so the
    // parent can retry. Because the idempotency key is derived from the booking
    // rather than from the click, a retry reuses the same key: if money did in
    // fact move the first time, the provider collapses the second request onto
    // it instead of charging twice.
    let charge: Awaited<ReturnType<PaymentGateway['charge']>>;
    try {
      charge = await this.gateway.charge({ amountCents, token, idempotencyKey });
    } catch (e) {
      this.logger.error(
        `payment provider failed for booking ${bookingId}; leaving it pending so it can be retried`,
        e instanceof Error ? e.stack : String(e),
      );
      throw new BookingError(
        'PAYMENT_PROVIDER_UNAVAILABLE',
        'the payment provider could not be reached; the booking is unchanged and can be retried',
      );
    }

    // ---- 4. Declined: record it, consume no seat ---------------------------
    if (charge.status === 'failed') {
      await this.uow.run(async (repos) => {
        await repos.payments.record({
          bookingId,
          status: 'failed',
          amountCents,
          providerRef: charge.providerRef,
          idempotencyKey,
          failureReason: charge.failureReason,
        });
        booking.failPayment();
        await repos.bookings.save(booking);
      });
      return {
        bookingId,
        status: BookingStatus.PaymentFailed,
        payment: 'failed',
        failureReason: charge.failureReason,
      };
    }

    // ---- 5. Record the money. The unique idempotency key is what makes two
    //         simultaneous requests collapse into one charge. ----------------
    try {
      await this.uow.run((repos) =>
        repos.payments.record({
          bookingId,
          status: 'succeeded',
          amountCents,
          providerRef: charge.providerRef,
          idempotencyKey,
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) {
        const current = await this.uow.run((r) => r.bookings.findById(bookingId));
        return {
          bookingId,
          status: current?.status ?? BookingStatus.PendingPayment,
          payment: 'succeeded',
          replayed: true,
        };
      }
      throw e;
    }

    // ---- 6. Claim the seat -------------------------------------------------
    const seat = await this.claimSeat.execute(bookingId);

    // ---- 7. Paid but no seat: give the money back --------------------------
    if (seat.outcome === 'seat_unavailable' || seat.outcome === 'duplicate') {
      await this.gateway.refund({ providerRef: charge.providerRef, amountCents });
      const settled = await this.uow.run(async (repos) => {
        const b = await repos.bookings.findById(bookingId);
        b!.settleRefund();
        await repos.bookings.save(b!);
        return b!;
      });
      this.logger.warn(`refunded booking ${bookingId}: paid but ${seat.outcome}`);
      return {
        bookingId,
        status: settled.status,
        payment: 'succeeded',
        seat: seat.outcome,
        refunded: true,
      };
    }

    return {
      bookingId,
      status: BookingStatus.Confirmed,
      payment: 'succeeded',
      seat: seat.outcome,
    };
  }
}

/** Prisma's unique-violation code, kept at the edge of the use case. */
function isUniqueViolation(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: string }).code === 'P2002';
}
