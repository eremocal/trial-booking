import { Injectable } from '@nestjs/common';
import { BookingStatus } from '../domain/booking/booking-status';
import { notFound } from '../domain/booking/errors';
import { PrismaService } from '../infrastructure/prisma/prisma.service';

/**
 * Read model for the catalogue and teacher/admin views.
 *
 * Talks to Prisma directly rather than loading aggregates: reads protect no
 * invariants. The roster lists CONFIRMED bookings only, so a child whose parent
 * is mid-payment never appears on it.
 */
@Injectable()
export class RosterQuery {
  constructor(private readonly prisma: PrismaService) {}

  async forClass(trialClassId: string) {
    const trialClass = await this.prisma.trialClass.findUnique({
      where: { id: trialClassId },
      include: {
        bookings: {
          where: { status: BookingStatus.Confirmed },
          orderBy: { confirmedAt: 'asc' },
          include: { student: { include: { parent: true } } },
        },
      },
    });
    if (!trialClass) throw notFound('CLASS', trialClassId);

    // Recount from booking rows rather than trusting confirmed_count. The
    // counter is what the CHECK constraint guards; the rows are the truth. If
    // they ever disagree the roster says so rather than quietly picking one.
    const actualConfirmed = trialClass.bookings.length;

    return {
      trialClassId: trialClass.id,
      title: trialClass.title,
      subject: trialClass.subject,
      startsAt: trialClass.startsAt,
      capacity: trialClass.capacity,
      seatsTaken: actualConfirmed,
      seatsRemaining: trialClass.capacity - actualConfirmed,
      counterHealthy: actualConfirmed === trialClass.confirmedCount,
      students: trialClass.bookings.map((b) => ({
        bookingId: b.id,
        studentId: b.student.id,
        studentName: b.student.name,
        parentName: b.student.parent.name,
        parentEmail: b.student.parent.email,
        confirmedAt: b.confirmedAt,
      })),
    };
  }

  async overview() {
    const classes = await this.prisma.trialClass.findMany({
      orderBy: { startsAt: 'asc' },
      include: {
        _count: { select: { bookings: { where: { status: BookingStatus.Confirmed } } } },
      },
    });
    return classes.map((c) => ({
      id: c.id,
      title: c.title,
      subject: c.subject,
      startsAt: c.startsAt,
      priceCents: c.priceCents,
      capacity: c.capacity,
      seatsTaken: c._count.bookings,
      seatsRemaining: c.capacity - c._count.bookings,
      counterHealthy: c._count.bookings === c.confirmedCount,
    }));
  }

  /** Money taken, no seat given. The refund work queue. */
  async refundsOwed() {
    return this.prisma.booking.findMany({
      where: { refundOwed: true },
      include: { student: true, trialClass: true, paymentAttempts: true },
    });
  }

  async booking(bookingId: string) {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: {
        student: true,
        trialClass: true,
        paymentAttempts: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!booking) throw notFound('BOOKING', bookingId);
    return booking;
  }

  listParents() {
    return this.prisma.parent.findMany({
      include: { students: true },
      orderBy: { name: 'asc' },
    });
  }
}
