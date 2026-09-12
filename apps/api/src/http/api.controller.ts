import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { BookTrialUseCase } from '../application/book-trial.usecase';
import { CancelBookingUseCase } from '../application/cancel-booking.usecase';
import { PayForBookingUseCase } from '../application/pay-for-booking.usecase';
import { RosterQuery } from '../application/roster.query';
import { CreateBookingDto, PayBookingDto } from './dto';
import { bookingResponse } from './presenters';

/**
 * Controllers are a thin edge: parse, delegate to one use case, return.
 * No rules live here, which is why the same use cases are callable from a test,
 * a CLI, or a background job without an HTTP server.
 */

@Controller('api')
export class CatalogController {
  constructor(private readonly roster: RosterQuery) {}

  @Get('parents')
  listParents() {
    return this.roster.listParents();
  }

  /** Seat counts come from confirmed rows, so a parent never sees a stale total. */
  @Get('trial-classes')
  listClasses() {
    return this.roster.overview();
  }
}

@Controller('api/bookings')
export class BookingController {
  constructor(
    private readonly bookTrial: BookTrialUseCase,
    private readonly payForBooking: PayForBookingUseCase,
    private readonly cancelBooking: CancelBookingUseCase,
    private readonly roster: RosterQuery,
  ) {}

  /** Step 1: reserve nothing, create a pending booking. */
  @Post()
  async create(@Body() dto: CreateBookingDto) {
    return bookingResponse(await this.bookTrial.execute(dto));
  }

  /** Step 2: pay, then try to claim a seat. The race is decided in here. */
  @Post(':id/pay')
  pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayBookingDto) {
    return this.payForBooking.execute({
      bookingId: id,
      idempotencyKey: dto.idempotencyKey,
      token: dto.token,
    });
  }

  /** Step 3: what happened. */
  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.roster.booking(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id', ParseUUIDPipe) id: string) {
    return bookingResponse(await this.cancelBooking.execute(id));
  }
}

@Controller('api/admin')
export class AdminController {
  constructor(private readonly roster: RosterQuery) {}

  @Get('trial-classes/:id/roster')
  rosterFor(@Param('id', ParseUUIDPipe) id: string) {
    return this.roster.forClass(id);
  }

  /** The refund work queue: money taken, no seat given. */
  @Get('refunds-owed')
  refunds() {
    return this.roster.refundsOwed();
  }
}
