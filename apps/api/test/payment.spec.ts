/**
 * Payment behaviour: failure must never seat a child, and replays must never
 * charge twice or claim two seats.
 */
import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { MockPaymentGateway } from '../src/infrastructure/payment/mock-gateway.adapter';
import {
  at, buildUseCases, prisma, resetDb, makeClass, makeParentWithStudents, seatStudents,
} from './helpers';

const T = MockPaymentGateway.TOKENS;

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

describe('payment failure', () => {
  it('a declined card leaves the child OFF the roster', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'decline');
    const booking = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });

    const result = await app.payForBooking.execute({
      bookingId: booking.id,
      idempotencyKey: 'key-declined-1',
      token: T.DECLINED,
    });

    expect(result.payment).toBe('failed');
    expect(result.status).toBe('payment_failed');
    expect(result.failureReason).toBe('card_declined');

    // The seat was never consumed.
    const after = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(after.confirmedCount).toBe(0);

    const roster = await prisma.booking.count({
      where: { trialClassId: trialClass.id, status: 'confirmed' },
    });
    expect(roster).toBe(0);
  });

  it('the failed attempt is recorded for support to look at', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'record');
    const booking = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });
    await app.payForBooking.execute({
      bookingId: booking.id,
      idempotencyKey: 'key-recorded-1',
      token: T.INSUFFICIENT,
    });

    const attempts = await prisma.paymentAttempt.findMany({
      where: { bookingId: booking.id },
    });
    expect(attempts).toHaveLength(1);
    expect(at(attempts, 0).status).toBe('failed');
    expect(at(attempts, 0).failureReason).toBe('insufficient_funds');
    expect(at(attempts, 0).amountCents).toBe(trialClass.priceCents);
  });

  it('a parent can retry with a good card after a decline', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'retry');
    const first = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });
    await app.payForBooking.execute({ bookingId: first.id, idempotencyKey: 'retry-1', token: T.DECLINED });

    // A fresh booking, because the old one is terminal.
    const second = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });
    const result = await app.payForBooking.execute({
      bookingId: second.id,
      idempotencyKey: 'retry-2',
      token: T.OK,
    });

    expect(result.status).toBe('confirmed');
    const after = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(after.confirmedCount).toBe(1);
  });
});

describe('idempotency', () => {
  it('a double-clicked pay button charges once and takes one seat', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'dbl');
    const booking = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });

    const key = 'double-click-key';
    const first = await app.payForBooking.execute({ bookingId: booking.id, idempotencyKey: key, token: T.OK });
    const second = await app.payForBooking.execute({ bookingId: booking.id, idempotencyKey: key, token: T.OK });

    expect(first.status).toBe('confirmed');
    expect(second.replayed).toBe(true);

    const attempts = await prisma.paymentAttempt.count({ where: { bookingId: booking.id } });
    expect(attempts).toBe(1);

    const after = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(after.confirmedCount).toBe(1);
  });

  it('two SIMULTANEOUS requests with the same key still charge once', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'concurrent-key');
    const booking = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });

    const key = 'simultaneous-key';
    await Promise.all([
      app.payForBooking.execute({ bookingId: booking.id, idempotencyKey: key, token: T.SLOW }),
      app.payForBooking.execute({ bookingId: booking.id, idempotencyKey: key, token: T.SLOW }),
    ]);

    const attempts = await prisma.paymentAttempt.count({ where: { bookingId: booking.id } });
    expect(attempts).toBe(1);

    const after = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(after.confirmedCount).toBe(1);
  });
});

describe('paid but no seat', () => {
  it('refunds the loser of the last-seat race', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    await seatStudents(trialClass.id, 3);
    const { students } = await makeParentWithStudents(2, 'refund-race');

    const a = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });
    const b = await app.bookTrial.execute({
      studentId: at(students, 1).id,
      trialClassId: trialClass.id,
    });

    const winner = await app.payForBooking.execute({ bookingId: b.id, idempotencyKey: 'r-b', token: T.OK });
    const loser = await app.payForBooking.execute({ bookingId: a.id, idempotencyKey: 'r-a', token: T.OK });

    expect(winner.status).toBe('confirmed');

    // The loser's money moved, so the loser gets it back.
    expect(loser.payment).toBe('succeeded');
    expect(loser.seat).toBe('seat_unavailable');
    expect(loser.refunded).toBe(true);
    expect(loser.status).toBe('seat_unavailable');

    const after = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(after.confirmedCount).toBe(4);
  });
});

describe('duplicate bookings', () => {
  it('a child already confirmed cannot start a second booking for the class', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'dupe');
    const booking = await app.bookTrial.execute({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
    });
    await app.payForBooking.execute({ bookingId: booking.id, idempotencyKey: 'dupe-1', token: T.OK });

    await expect(
      app.bookTrial.execute({ studentId: at(students, 0).id, trialClassId: trialClass.id }),
    ).rejects.toMatchObject({ code: 'ALREADY_CONFIRMED' });

    const confirmed = await prisma.booking.count({
      where: { trialClassId: trialClass.id, studentId: at(students, 0).id, status: 'confirmed' },
    });
    expect(confirmed).toBe(1);
  });

  it('a full class refuses a new booking up front', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    await seatStudents(trialClass.id, 4);
    const { students } = await makeParentWithStudents(1, 'full');

    await expect(
      app.bookTrial.execute({ studentId: at(students, 0).id, trialClassId: trialClass.id }),
    ).rejects.toMatchObject({ code: 'CLASS_FULL' });
  });
});
