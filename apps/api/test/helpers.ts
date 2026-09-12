import { PrismaService } from '../src/infrastructure/prisma/prisma.service';

/** The same PrismaService the app uses, so no casts are needed. */
export const prisma = new PrismaService();

export async function resetDb() {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE payment_attempts, bookings, trial_classes, students, parents
    RESTART IDENTITY CASCADE;
  `);
}

export async function makeParentWithStudents(count: number, prefix = 's') {
  const parent = await prisma.parent.create({
    data: { email: `${prefix}-${Date.now()}-${Math.random()}@example.com`, name: 'Test Parent' },
  });
  const students = await Promise.all(
    Array.from({ length: count }, (_, i) =>
      prisma.student.create({
        data: { parentId: parent.id, name: `${prefix} child ${i + 1}`, birthYear: 2015 },
      }),
    ),
  );
  return { parent, students };
}

export async function makeClass(opts: { capacity?: number; confirmedCount?: number } = {}) {
  return prisma.trialClass.create({
    data: {
      subject: 'math',
      title: 'Test Trial Class',
      startsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      capacity: opts.capacity ?? 4,
      confirmedCount: opts.confirmedCount ?? 0,
    },
  });
}

/** Fill a class to `n` confirmed bookings with throwaway students. */
export async function seatStudents(trialClassId: string, n: number) {
  const { students } = await makeParentWithStudents(n, 'seated');
  for (const s of students) {
    await prisma.booking.create({
      data: {
        studentId: s.id,
        trialClassId,
        status: 'confirmed',
        confirmedAt: new Date(),
      },
    });
  }
  await prisma.trialClass.update({
    where: { id: trialClassId },
    data: { confirmedCount: n },
  });
  return students;
}

// --- Composition for tests -------------------------------------------------
// Mirrors what AppModule wires in production, without Nest's DI container.
import { BookTrialUseCase } from '../src/application/book-trial.usecase';
import { CancelBookingUseCase } from '../src/application/cancel-booking.usecase';
import { ClaimSeatUseCase } from '../src/application/claim-seat.usecase';
import { PayForBookingUseCase } from '../src/application/pay-for-booking.usecase';
import { MockPaymentGateway } from '../src/infrastructure/payment/mock-gateway.adapter';
import { PrismaUnitOfWork } from '../src/infrastructure/prisma/unit-of-work';

export function buildUseCases() {
  const uow = new PrismaUnitOfWork(prisma);
  const gateway = new MockPaymentGateway();
  const claimSeat = new ClaimSeatUseCase(uow);
  return {
    uow,
    gateway,
    bookTrial: new BookTrialUseCase(uow),
    claimSeat,
    payForBooking: new PayForBookingUseCase(uow, gateway, claimSeat),
    cancelBooking: new CancelBookingUseCase(uow),
  };
}

/**
 * Indexed access that fails with a clear message. `noUncheckedIndexedAccess`
 * types `items[0]` as possibly undefined.
 */
export function at<T>(items: T[], index: number): T {
  const item = items[index];
  if (item === undefined) {
    throw new Error(`expected an element at index ${index}, got ${items.length} items`);
  }
  return item;
}
