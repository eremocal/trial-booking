/**
 * Seed data for the trial class booking demo.
 *
 * IDs are fixed so scripts/demo.sh can reference known rows.
 *
 * The dataset deliberately covers the four cases the brief asks to see:
 *   1. a class with available seats          -> SCI_OPEN    (0/4 confirmed)
 *   2. a class with exactly 3 confirmed      -> MATH_LAST   (3/4 confirmed)
 *   3. a duplicate booking attempt           -> Ana is confirmed in MATH_LAST AND
 *                                              has a second, cancelled+refunded
 *                                              booking for that same class
 *   4. a payment failure case                -> Ben has a payment_failed booking
 *
 * Plus one the brief implies but does not list:
 *   5. a class that is already full          -> SCI_FULL    (4/4 confirmed)
 */
import '../src/common/env';
import { PrismaClient, BookingStatus, PaymentStatus } from '@prisma/client';

const prisma = new PrismaClient();

export const IDS = {
  parents: {
    maria: '11111111-1111-4111-8111-111111111111',
    james: '11111111-1111-4111-8111-111111111112',
    aisha: '11111111-1111-4111-8111-111111111113',
  },
  students: {
    ana: '22222222-2222-4222-8222-222222222221',   // Maria's
    ben: '22222222-2222-4222-8222-222222222222',   // Maria's
    chloe: '22222222-2222-4222-8222-222222222223', // James's
    dev: '22222222-2222-4222-8222-222222222224',   // James's
    elif: '22222222-2222-4222-8222-222222222225',  // Aisha's
  },
  classes: {
    sciOpen: '33333333-3333-4333-8333-333333333331',  // 0/4 — plenty of room
    mathLast: '33333333-3333-4333-8333-333333333332', // 3/4 — ONE SEAT LEFT
    sciFull: '33333333-3333-4333-8333-333333333333',  // 4/4 — full
  },
} as const;

/** Fixed clock so seeded timestamps are stable across runs. */
const NOW = new Date('2026-10-01T09:00:00Z');
const daysFromNow = (d: number) =>
  new Date(NOW.getTime() + d * 24 * 60 * 60 * 1000);

async function main() {
  // Truncate rather than upsert: the seed is a known-good starting state, and
  // RESTART IDENTITY CASCADE keeps confirmed_count from drifting across runs.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE payment_attempts, bookings, trial_classes, students, parents
    RESTART IDENTITY CASCADE;
  `);

  await prisma.parent.createMany({
    data: [
      { id: IDS.parents.maria, email: 'maria@example.com', name: 'Maria Santos' },
      { id: IDS.parents.james, email: 'james@example.com', name: 'James Lee' },
      { id: IDS.parents.aisha, email: 'aisha@example.com', name: 'Aisha Khan' },
    ],
  });

  await prisma.student.createMany({
    data: [
      { id: IDS.students.ana, parentId: IDS.parents.maria, name: 'Ana Santos', birthYear: 2015 },
      { id: IDS.students.ben, parentId: IDS.parents.maria, name: 'Ben Santos', birthYear: 2017 },
      { id: IDS.students.chloe, parentId: IDS.parents.james, name: 'Chloe Lee', birthYear: 2016 },
      { id: IDS.students.dev, parentId: IDS.parents.james, name: 'Dev Lee', birthYear: 2014 },
      { id: IDS.students.elif, parentId: IDS.parents.aisha, name: 'Elif Khan', birthYear: 2015 },
    ],
  });

  await prisma.trialClass.createMany({
    data: [
      {
        id: IDS.classes.sciOpen,
        subject: 'science',
        title: 'Trial: Why Volcanoes Erupt',
        startsAt: daysFromNow(3),
        capacity: 4,
        confirmedCount: 0,
      },
      {
        id: IDS.classes.mathLast,
        subject: 'math',
        title: 'Trial: Fractions Without Fear',
        startsAt: daysFromNow(4),
        capacity: 4,
        confirmedCount: 3, // <- the last-seat race happens here
      },
      {
        id: IDS.classes.sciFull,
        subject: 'science',
        title: 'Trial: Building Simple Circuits',
        startsAt: daysFromNow(5),
        capacity: 4,
        confirmedCount: 4, // <- already full
      },
    ],
  });

  // --- MATH_LAST: 3 confirmed, so exactly one seat remains -------------------
  // Ana is one of them, which also sets up the duplicate-booking case: any
  // further attempt to confirm Ana into this class must be rejected.
  await prisma.booking.createMany({
    data: [
      mkBooking('44444444-0000-4000-8000-000000000001', IDS.students.ana, IDS.classes.mathLast, BookingStatus.confirmed),
      mkBooking('44444444-0000-4000-8000-000000000002', IDS.students.chloe, IDS.classes.mathLast, BookingStatus.confirmed),
      mkBooking('44444444-0000-4000-8000-000000000003', IDS.students.dev, IDS.classes.mathLast, BookingStatus.confirmed),
    ],
  });

  // --- SCI_FULL: 4 confirmed -------------------------------------------------
  await prisma.booking.createMany({
    data: [
      mkBooking('44444444-0000-4000-8000-000000000011', IDS.students.ana, IDS.classes.sciFull, BookingStatus.confirmed),
      mkBooking('44444444-0000-4000-8000-000000000012', IDS.students.ben, IDS.classes.sciFull, BookingStatus.confirmed),
      mkBooking('44444444-0000-4000-8000-000000000013', IDS.students.chloe, IDS.classes.sciFull, BookingStatus.confirmed),
      mkBooking('44444444-0000-4000-8000-000000000014', IDS.students.dev, IDS.classes.sciFull, BookingStatus.confirmed),
    ],
  });

  // --- Duplicate booking attempt ---------------------------------------------
  // Ana is already confirmed in MATH_LAST (above). This is a SECOND booking for
  // the same child and the same class: the parent paid, and by the time the seat
  // was claimed the duplicate was detected, so it was cancelled and refunded.
  // No second seat was consumed -- MATH_LAST stays at 3 confirmed.
  //
  // The partial unique index permits this row precisely because it is not
  // `confirmed`; a plain UNIQUE(student, class) would have made the retry and
  // the refund trail impossible to record.
  const anaDuplicate = '44444444-0000-4000-8000-000000000031';
  await prisma.booking.create({
    data: {
      id: anaDuplicate,
      studentId: IDS.students.ana,
      trialClassId: IDS.classes.mathLast,
      status: BookingStatus.cancelled,
      refundOwed: false, // already settled; see payment attempt below
      createdAt: NOW,
    },
  });
  await prisma.paymentAttempt.create({
    data: {
      id: '55555555-0000-4000-8000-000000000031',
      bookingId: anaDuplicate,
      status: PaymentStatus.succeeded,
      amountCents: 1500,
      providerRef: 'mock_pi_duplicate_0031',
      idempotencyKey: 'seed-ana-duplicate-attempt-1',
      createdAt: NOW,
    },
  });

  // --- Payment failure case --------------------------------------------------
  // Ben tried SCI_OPEN and the card was declined. No seat was consumed
  // (SCI_OPEN stays at 0/4), and Ben is free to retry: the partial unique
  // index only constrains CONFIRMED rows.
  const benFailed = '44444444-0000-4000-8000-000000000021';
  await prisma.booking.create({
    data: {
      id: benFailed,
      studentId: IDS.students.ben,
      trialClassId: IDS.classes.sciOpen,
      status: BookingStatus.payment_failed,
      createdAt: NOW,
    },
  });
  await prisma.paymentAttempt.create({
    data: {
      id: '55555555-0000-4000-8000-000000000021',
      bookingId: benFailed,
      status: PaymentStatus.failed,
      amountCents: 1500,
      providerRef: 'mock_pi_declined_0021',
      idempotencyKey: 'seed-ben-sciopen-attempt-1',
      failureReason: 'card_declined',
      createdAt: NOW,
    },
  });

  // Every confirmed booking above needs a matching successful payment, so the
  // roster and the money story agree. (The duplicate and the declined attempt
  // already have their own, above.)
  await backfillPaymentsForConfirmed();

  await report();
}

function mkBooking(
  id: string,
  studentId: string,
  trialClassId: string,
  status: BookingStatus,
) {
  return {
    id,
    studentId,
    trialClassId,
    status,
    createdAt: NOW,
    confirmedAt: status === BookingStatus.confirmed ? NOW : null,
  };
}

async function backfillPaymentsForConfirmed() {
  const confirmed = await prisma.booking.findMany({
    where: { status: BookingStatus.confirmed },
    select: { id: true, trialClass: { select: { priceCents: true } } },
  });
  await prisma.paymentAttempt.createMany({
    data: confirmed.map((b, i) => ({
      bookingId: b.id,
      status: PaymentStatus.succeeded,
      amountCents: b.trialClass.priceCents,
      providerRef: `mock_pi_seed_${i}`,
      idempotencyKey: `seed-confirmed-${b.id}`,
      createdAt: NOW,
    })),
  });
}

/** Print the seeded state, and assert confirmed_count matches reality. */
async function report() {
  const classes = await prisma.trialClass.findMany({ orderBy: { startsAt: 'asc' } });
  console.log('\n  Seeded trial classes:');
  for (const c of classes) {
    const actual = await prisma.booking.count({
      where: { trialClassId: c.id, status: BookingStatus.confirmed },
    });
    const drift = actual === c.confirmedCount ? 'ok' : `DRIFT (actual ${actual})`;
    console.log(
      `    ${c.title.padEnd(36)} ${c.confirmedCount}/${c.capacity} confirmed   ${drift}`,
    );
    if (actual !== c.confirmedCount) {
      throw new Error(
        `Seed is inconsistent: ${c.title} says ${c.confirmedCount} but has ${actual} confirmed bookings.`,
      );
    }
  }
  const [parents, students, bookings, payments] = await Promise.all([
    prisma.parent.count(),
    prisma.student.count(),
    prisma.booking.count(),
    prisma.paymentAttempt.count(),
  ]);
  console.log(
    `\n  ${parents} parents, ${students} students, ${bookings} bookings, ${payments} payment attempts\n`,
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
