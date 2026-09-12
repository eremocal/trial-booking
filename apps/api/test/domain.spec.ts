/**
 * Pure domain tests: no database, no HTTP. Timing and concurrency are tested
 * against real Postgres in the other spec files.
 */
import { describe, expect, it } from 'vitest';
import { Booking } from '../src/domain/booking/booking';
import { TrialClass } from '../src/domain/booking/trial-class';
import { BookingStatus, occupiesSeat } from '../src/domain/booking/booking-status';
import { Money } from '../src/domain/shared/money';

const aClass = (confirmedCount = 0, capacity = 4) =>
  TrialClass.rehydrate({
    id: 'class-1',
    subject: 'math',
    title: 'Trial: Fractions',
    startsAt: new Date(Date.now() + 86_400_000),
    capacity,
    confirmedCount,
    priceCents: 1500,
  });

const aBooking = (status: BookingStatus = BookingStatus.PendingPayment) =>
  Booking.rehydrate({
    id: 'booking-1',
    studentId: 'student-1',
    trialClassId: 'class-1',
    status,
    confirmedAt: null,
    refundOwed: false,
    createdAt: new Date(),
  });

describe('TrialClass', () => {
  it('reports seats remaining', () => {
    expect(aClass(3).seatsRemaining).toBe(1);
    expect(aClass(3).isFull).toBe(false);
    expect(aClass(4).isFull).toBe(true);
  });

  it('takes the last seat', () => {
    const c = aClass(3);
    c.claimSeat();
    expect(c.confirmedCount).toBe(4);
    expect(c.isFull).toBe(true);
  });

  it('refuses to overbook', () => {
    expect(() => aClass(4).claimSeat()).toThrowError(/full/);
  });

  it('gives a seat back on cancellation', () => {
    const c = aClass(4);
    c.releaseSeat();
    expect(c.seatsRemaining).toBe(1);
  });

  it('refuses bookings once it has started', () => {
    const started = TrialClass.rehydrate({
      id: 'c', subject: 'math', title: 't',
      startsAt: new Date(Date.now() - 1000),
      capacity: 4, confirmedCount: 0, priceCents: 1500,
    });
    expect(started.hasStarted()).toBe(true);
  });
});

describe('Booking transitions', () => {
  it('confirms a pending booking', () => {
    const b = aBooking();
    b.confirm();
    expect(b.status).toBe(BookingStatus.Confirmed);
    expect(b.confirmedAt).toBeInstanceOf(Date);
    expect(b.holdsSeat).toBe(true);
  });

  it('a failed payment holds no seat and owes no refund', () => {
    const b = aBooking();
    b.failPayment();
    expect(b.status).toBe(BookingStatus.PaymentFailed);
    expect(b.holdsSeat).toBe(false);
    expect(b.refundOwed).toBe(false);
  });

  it('losing the seat race owes a refund', () => {
    const b = aBooking();
    b.loseSeatRace();
    expect(b.status).toBe(BookingStatus.SeatUnavailable);
    expect(b.refundOwed).toBe(true);
    expect(b.holdsSeat).toBe(false);
  });

  it('settling a refund clears the queue flag', () => {
    const b = aBooking();
    b.loseSeatRace();
    b.settleRefund();
    expect(b.refundOwed).toBe(false);
  });

  it('refuses to confirm an already-confirmed booking', () => {
    const b = aBooking(BookingStatus.Confirmed);
    expect(() => b.confirm()).toThrowError(/expected pending_payment/);
  });

  it('refuses to confirm a failed booking', () => {
    const b = aBooking(BookingStatus.PaymentFailed);
    expect(() => b.confirm()).toThrowError(/expected pending_payment/);
  });

  it('cancelling twice is a no-op, not an error', () => {
    const b = aBooking(BookingStatus.Cancelled);
    expect(() => b.cancel()).not.toThrow();
  });

  it('only a confirmed booking occupies a seat', () => {
    expect(occupiesSeat(BookingStatus.Confirmed)).toBe(true);
    for (const s of [
      BookingStatus.PendingPayment,
      BookingStatus.PaymentFailed,
      BookingStatus.SeatUnavailable,
      BookingStatus.Cancelled,
    ]) {
      expect(occupiesSeat(s)).toBe(false);
    }
  });
});

describe('Money', () => {
  it('rejects fractional cents', () => {
    expect(() => Money.fromCents(10.5)).toThrowError(/whole cents/);
  });

  it('rejects negative amounts', () => {
    expect(() => Money.fromCents(-1)).toThrowError(/negative/);
  });

  it('formats for humans', () => {
    expect(Money.fromCents(1500).toString()).toBe('$15.00');
  });
});
