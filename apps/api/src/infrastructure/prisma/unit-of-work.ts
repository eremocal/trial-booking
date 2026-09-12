import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Repositories, UnitOfWork } from '../../domain/booking/ports';
import { PrismaService } from './prisma.service';
import {
  PrismaBookingRepository,
  PrismaPaymentAttemptRepository,
  PrismaStudentRepository,
  PrismaTrialClassRepository,
} from './repositories';

/**
 * One transaction, one set of repositories bound to it.
 *
 * READ COMMITTED is sufficient *because* of the explicit row lock taken in
 * `findByIdForUpdate`. SERIALIZABLE would also be correct, but it would turn
 * the loser of a seat race into a serialization failure that has to be retried,
 * where here the loser simply blocks and then reads the truth.
 */
@Injectable()
export class PrismaUnitOfWork implements UnitOfWork {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(work: (repos: Repositories) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(
      async (tx) =>
        work({
          bookings: new PrismaBookingRepository(tx),
          trialClasses: new PrismaTrialClassRepository(tx),
          students: new PrismaStudentRepository(tx),
          payments: new PrismaPaymentAttemptRepository(tx),
        }),
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 10_000,
      },
    );
  }
}
