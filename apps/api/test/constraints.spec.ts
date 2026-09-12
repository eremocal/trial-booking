/**
 * Database-enforced invariants, tested by writing straight to Postgres and
 * bypassing the application. The race tests never reach these constraints,
 * because the row lock stops a bad write first; these prove the constraints
 * still refuse one if the application logic is ever wrong.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { at, makeClass, makeParentWithStudents, prisma, resetDb } from './helpers';

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('capacity CHECK constraint', () => {
  it('refuses a 5th confirmed seat', async () => {
    const trialClass = await makeClass({ capacity: 4, confirmedCount: 4 });

    await expect(
      prisma.$executeRaw`UPDATE trial_classes SET confirmed_count = 5 WHERE id = ${trialClass.id}`,
    ).rejects.toThrow(/capacity_not_exceeded/);
  });

  it('refuses a negative seat count', async () => {
    const trialClass = await makeClass({ capacity: 4, confirmedCount: 0 });

    await expect(
      prisma.$executeRaw`UPDATE trial_classes SET confirmed_count = -1 WHERE id = ${trialClass.id}`,
    ).rejects.toThrow(/capacity_not_exceeded/);
  });
});

describe('partial unique index on confirmed bookings', () => {
  it('refuses a second confirmed booking for the same child and class', async () => {
    const trialClass = await makeClass();
    const { students } = await makeParentWithStudents(1, 'dup');
    const studentId = at(students, 0).id;

    await prisma.booking.create({
      data: { studentId, trialClassId: trialClass.id, status: 'confirmed' },
    });

    await expect(
      prisma.booking.create({
        data: { studentId, trialClassId: trialClass.id, status: 'confirmed' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('still allows failed and cancelled bookings next to a confirmed one', async () => {
    const trialClass = await makeClass();
    const { students } = await makeParentWithStudents(1, 'retry');
    const studentId = at(students, 0).id;

    for (const status of ['payment_failed', 'cancelled', 'confirmed'] as const) {
      await prisma.booking.create({ data: { studentId, trialClassId: trialClass.id, status } });
    }

    const rows = await prisma.booking.count({ where: { studentId, trialClassId: trialClass.id } });
    expect(rows).toBe(3);
  });
});

describe('unique idempotency key', () => {
  it('refuses a second payment attempt with the same key', async () => {
    const trialClass = await makeClass();
    const { students } = await makeParentWithStudents(1, 'idem');
    const booking = await prisma.booking.create({
      data: { studentId: at(students, 0).id, trialClassId: trialClass.id },
    });
    const attempt = {
      bookingId: booking.id,
      status: 'succeeded' as const,
      amountCents: 1500,
      providerRef: 'mock_pi_test',
      idempotencyKey: 'same-key-0001',
    };

    await prisma.paymentAttempt.create({ data: attempt });

    await expect(prisma.paymentAttempt.create({ data: attempt })).rejects.toMatchObject({
      code: 'P2002',
    });
  });
});
