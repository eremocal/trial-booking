import { Global, Module } from '@nestjs/common';
import { BookTrialUseCase } from './application/book-trial.usecase';
import { CancelBookingUseCase } from './application/cancel-booking.usecase';
import { ClaimSeatUseCase } from './application/claim-seat.usecase';
import { PayForBookingUseCase } from './application/pay-for-booking.usecase';
import { RosterQuery } from './application/roster.query';
import { UNIT_OF_WORK } from './domain/booking/ports';
import { PAYMENT_GATEWAY } from './domain/payment/ports';
import { MockPaymentGateway } from './infrastructure/payment/mock-gateway.adapter';
import { PrismaService } from './infrastructure/prisma/prisma.service';
import { PrismaUnitOfWork } from './infrastructure/prisma/unit-of-work';
import { AdminController, BookingController, CatalogController } from './http/api.controller';
import { HealthController } from './http/health.controller';

/**
 * Composition root.
 *
 * This is the only file that knows both halves: which concrete adapter satisfies
 * which port. Swapping Postgres for something else, or the mock gateway for
 * Stripe, is a change here and nowhere else -- nothing in domain/ or
 * application/ imports an adapter.
 */
@Global()
@Module({
  controllers: [CatalogController, BookingController, AdminController, HealthController],
  providers: [
    PrismaService,

    // Ports -> adapters
    { provide: UNIT_OF_WORK, useClass: PrismaUnitOfWork },
    { provide: PAYMENT_GATEWAY, useClass: MockPaymentGateway },

    // Use cases
    BookTrialUseCase,
    ClaimSeatUseCase,
    PayForBookingUseCase,
    CancelBookingUseCase,

    // Read model
    RosterQuery,
  ],
  exports: [PrismaService],
})
export class AppModule {}
