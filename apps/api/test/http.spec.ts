/**
 * HTTP contract tests. These boot the real Nest application and assert on the
 * JSON a client actually receives, which domain-level tests cannot catch: an
 * entity returned directly serialises its private `_status` instead of `status`.
 */
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module';
import { BookingErrorFilter } from '../src/http/booking-error.filter';
import { PrismaService } from '../src/infrastructure/prisma/prisma.service';
import { at, makeClass, makeParentWithStudents, prisma, resetDb, seatStudents } from './helpers';

let app: INestApplication;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    // Point the app at the test database rather than the demo one.
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new BookingErrorFilter());
  await app.init();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await resetDb();
});

describe('POST /api/bookings', () => {
  it('returns a booking whose shape is the API contract, not the entity internals', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'http');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id })
      .expect(201);

    expect(res.body).toMatchObject({
      studentId: at(students, 0).id,
      trialClassId: trialClass.id,
      status: 'pending_payment',
      refundOwed: false,
    });
    expect(res.body.id).toEqual(expect.any(String));

    // No private field may ever reach a client.
    for (const key of Object.keys(res.body)) {
      expect(key.startsWith('_')).toBe(false);
    }
  });

  it('rejects a malformed body', async () => {
    await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: 'not-a-uuid', trialClassId: 'nope' })
      .expect(400);
  });

  it('409s when the student is already confirmed in the class', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const [seated] = await seatStudents(trialClass.id, 1);

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: seated!.id, trialClassId: trialClass.id })
      .expect(409);

    expect(res.body).toMatchObject({ error: 'ALREADY_CONFIRMED' });
  });

  it('409s when the class is full', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    await seatStudents(trialClass.id, 4);
    const { students } = await makeParentWithStudents(1, 'full-http');

    const res = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id })
      .expect(409);

    expect(res.body).toMatchObject({ error: 'CLASS_FULL' });
  });
});

describe('POST /api/bookings/:id/pay', () => {
  it('confirms, and the payment attempt is recorded', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'pay-http');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id });

    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/pay`)
      .send({ idempotencyKey: 'http-pay-0001', token: 'tok_ok' })
      .expect(201);

    expect(res.body).toMatchObject({
      status: 'confirmed',
      payment: 'succeeded',
      seat: 'confirmed',
    });

    const attempts = await prisma.paymentAttempt.findMany({
      where: { bookingId: created.body.id },
    });
    expect(attempts).toHaveLength(1);
    expect(at(attempts, 0)).toMatchObject({
      status: 'succeeded',
      amountCents: trialClass.priceCents,
      idempotencyKey: 'http-pay-0001',
    });
  });

  it('records a declined payment and leaves the roster empty', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'decline-http');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id });

    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/pay`)
      .send({ idempotencyKey: 'http-decline-0001', token: 'tok_declined' })
      .expect(201);

    expect(res.body).toMatchObject({
      status: 'payment_failed',
      payment: 'failed',
      failureReason: 'card_declined',
    });

    const roster = await request(app.getHttpServer())
      .get(`/api/admin/trial-classes/${trialClass.id}/roster`)
      .expect(200);
    expect(roster.body.seatsTaken).toBe(0);
    expect(roster.body.students).toHaveLength(0);
  });
});

describe('POST /api/bookings/:id/pay — provider outage', () => {
  it('502s, leaves the booking payable, and records nothing', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'outage');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id });

    // The gateway THROWS rather than declining: the outcome is unknown.
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/pay`)
      .send({ idempotencyKey: 'http-outage-0001', token: 'tok_gateway_error' })
      .expect(502);

    expect(res.body).toMatchObject({ error: 'PAYMENT_PROVIDER_UNAVAILABLE' });

    // Nothing changed: no attempt written, booking still payable, no seat taken.
    const attempts = await prisma.paymentAttempt.findMany({
      where: { bookingId: created.body.id },
    });
    expect(attempts).toHaveLength(0);

    const after = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.id}`)
      .expect(200);
    expect(after.body.status).toBe('pending_payment');

    const cls = await prisma.trialClass.findUniqueOrThrow({ where: { id: trialClass.id } });
    expect(cls.confirmedCount).toBe(0);
  });

  it('the same booking can then be paid for successfully', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'outage-retry');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id });

    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/pay`)
      .send({ idempotencyKey: 'http-outage-retry', token: 'tok_gateway_error' })
      .expect(502);

    // Same idempotency key on the retry: if money HAD moved during the outage,
    // the provider collapses this onto that charge rather than taking a second.
    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/pay`)
      .send({ idempotencyKey: 'http-outage-retry', token: 'tok_ok' })
      .expect(201);

    expect(res.body).toMatchObject({ status: 'confirmed', payment: 'succeeded' });
  });
});

describe('GET /api/bookings/:id — status after submission', () => {
  it('exposes the status and the payment attempts', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'status-http');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id });
    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/pay`)
      .send({ idempotencyKey: 'http-status-0001', token: 'tok_ok' });

    const res = await request(app.getHttpServer())
      .get(`/api/bookings/${created.body.id}`)
      .expect(200);

    expect(res.body.status).toBe('confirmed');
    expect(res.body.paymentAttempts).toHaveLength(1);
    expect(res.body.trialClass.title).toBe(trialClass.title);
  });

  it('404s for an unknown booking', async () => {
    await request(app.getHttpServer())
      .get('/api/bookings/3f0e5b4a-0000-4000-8000-000000000000')
      .expect(404);
  });
});

describe('GET /api/admin/trial-classes/:id/roster', () => {
  it('lists confirmed students with their parent contact', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    await seatStudents(trialClass.id, 2);

    const res = await request(app.getHttpServer())
      .get(`/api/admin/trial-classes/${trialClass.id}/roster`)
      .expect(200);

    expect(res.body).toMatchObject({
      capacity: 4,
      seatsTaken: 2,
      seatsRemaining: 2,
      counterHealthy: true,
    });
    expect(res.body.students).toHaveLength(2);
    expect(at(res.body.students, 0)).toHaveProperty('parentEmail');
  });
});

describe('POST /api/bookings/:id/cancel', () => {
  it('frees the seat and returns the contract shape', async () => {
    const trialClass = await makeClass({ capacity: 4 });
    const { students } = await makeParentWithStudents(1, 'cancel-http');
    const created = await request(app.getHttpServer())
      .post('/api/bookings')
      .send({ studentId: at(students, 0).id, trialClassId: trialClass.id });
    await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/pay`)
      .send({ idempotencyKey: 'http-cancel-0001', token: 'tok_ok' });

    const res = await request(app.getHttpServer())
      .post(`/api/bookings/${created.body.id}/cancel`)
      .expect(201);

    expect(res.body.status).toBe('cancelled');
    for (const key of Object.keys(res.body)) {
      expect(key.startsWith('_')).toBe(false);
    }

    const roster = await request(app.getHttpServer())
      .get(`/api/admin/trial-classes/${trialClass.id}/roster`);
    expect(roster.body.seatsTaken).toBe(0);
  });
});
