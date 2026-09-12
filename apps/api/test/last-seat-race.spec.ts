/**
 * The required technical scenario, plus the general form of it.
 *
 * These are NOT mocked. Each contender runs in its own transaction against a
 * real Postgres instance, so the row lock and the isolation level are genuinely
 * exercised. The constraints behind them are tested in constraints.spec.ts.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import {
  at, buildUseCases, prisma, resetDb, makeClass, makeParentWithStudents, seatStudents,
} from './helpers';

let app: ReturnType<typeof buildUseCases>;

beforeAll(() => {
  app = buildUseCases();
});

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('last-seat race', () => {
  it('the brief scenario: A reaches payment first, B pays first, A pays second', async () => {
    // 3 of 4 seats are taken: exactly one seat remains.
    const trialClass = await makeClass({ capacity: 4, confirmedCount: 0 });
    await seatStudents(trialClass.id, 3);
    const { students } = await makeParentWithStudents(2, 'racer');
    const childA = at(students, 0);
    const childB = at(students, 1);

    // 1. User A selects the last slot and moves to payment.
    const bookingA = await app.bookTrial.execute({
      studentId: childA.id,
      trialClassId: trialClass.id,
    });

    // 2. User B selects the same slot. Both now hold pending bookings:
    //    a pending booking holds NO seat, so B is not blocked here.
    const bookingB = await app.bookTrial.execute({
      studentId: childB.id,
      trialClassId: trialClass.id,
    });
    expect(bookingA.status).toBe('pending_payment');
    expect(bookingB.status).toBe('pending_payment');

    // 3. User B completes payment first and confirms.
    const resultB = await app.claimSeat.execute(bookingB.id);
    expect(resultB.outcome).toBe('confirmed');

    // 4. User A then tries to complete payment.
    const resultA = await app.claimSeat.execute(bookingA.id);
    expect(resultA.outcome).toBe('seat_unavailable');
    expect(resultA).toMatchObject({ refundOwed: true });

    // Exactly one of them holds the seat, and the class is full, not overfull.
    const after = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(after.confirmedCount).toBe(4);

    const confirmed = await prisma.booking.count({
      where: { trialClassId: trialClass.id, status: 'confirmed' },
    });
    expect(confirmed).toBe(4);
  });

  it('20 parents paying simultaneously for 1 remaining seat: exactly 1 wins', async () => {
    const trialClass = await makeClass({ capacity: 4, confirmedCount: 0 });
    await seatStudents(trialClass.id, 3);
    const { students } = await makeParentWithStudents(20, 'stampede');

    const bookings = await Promise.all(
      students.map((s) =>
        app.bookTrial.execute({ studentId: s.id, trialClassId: trialClass.id }),
      ),
    );

    // Every one of them pays at the same instant.
    const results = await Promise.all(bookings.map((b) => app.claimSeat.execute(b.id)));

    const won = results.filter((r) => r.outcome === 'confirmed');
    const lost = results.filter((r) => r.outcome === 'seat_unavailable');

    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(19);

    const after = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(after.confirmedCount).toBe(4);
    expect(after.confirmedCount).toBeLessThanOrEqual(after.capacity);
  });

  it('20 parents racing for an EMPTY class: exactly 4 win, never 5', async () => {
    const trialClass = await makeClass({ capacity: 4, confirmedCount: 0 });
    const { students } = await makeParentWithStudents(20, 'empty-race');

    const bookings = await Promise.all(
      students.map((s) =>
        app.bookTrial.execute({ studentId: s.id, trialClassId: trialClass.id }),
      ),
    );
    const results = await Promise.all(bookings.map((b) => app.claimSeat.execute(b.id)));

    expect(results.filter((r) => r.outcome === 'confirmed')).toHaveLength(4);
    expect(results.filter((r) => r.outcome === 'seat_unavailable')).toHaveLength(16);

    const rows = await prisma.booking.count({
      where: { trialClassId: trialClass.id, status: 'confirmed' },
    });
    expect(rows).toBe(4);
  });

  it('confirmed_count never drifts from the real confirmed row count', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(12, 'drift');

    const bookings = await Promise.all(
      students.map((s) =>
        app.bookTrial.execute({ studentId: s.id, trialClassId: trialClass.id }),
      ),
    );
    await Promise.all(bookings.map((b) => app.claimSeat.execute(b.id)));

    const [cls, actual] = await Promise.all([
      prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } }),
      prisma.booking.count({
        where: { trialClassId: trialClass.id, status: 'confirmed' },
      }),
    ]);
    expect(cls.confirmedCount).toBe(actual);
  });
});
