import { Booking } from './booking';
import { TrialClass } from './trial-class';
import { BookingStatus } from './booking-status';

export interface TrialClassRepository {
  findById(id: string): Promise<TrialClass | null>;

  /**
   * Load the class holding a row lock for the rest of the transaction. Only
   * valid inside a unit of work.
   *
   * A lock is a persistence concern in a domain port, which is deliberate: it
   * keeps the one thing making this system correct visible in the signature,
   * rather than hidden in an adapter where a later change could drop it.
   */
  findByIdForUpdate(id: string): Promise<TrialClass | null>;

  save(trialClass: TrialClass): Promise<void>;
}

export interface BookingRepository {
  findById(id: string): Promise<Booking | null>;
  findOneBy(criteria: {
    studentId: string;
    trialClassId: string;
    status: BookingStatus;
  }): Promise<Booking | null>;
  create(input: { studentId: string; trialClassId: string }): Promise<Booking>;
  save(booking: Booking): Promise<void>;
}

export interface StudentRepository {
  exists(id: string): Promise<boolean>;
}

/** The repositories available inside a transaction. */
export interface Repositories {
  bookings: BookingRepository;
  trialClasses: TrialClassRepository;
  students: StudentRepository;
  payments: PaymentAttemptRepository;
}

/**
 * Transaction boundary. Everything inside one `run` commits or aborts together,
 * and row locks taken inside it are held until it ends.
 */
export interface UnitOfWork {
  run<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}

export interface PaymentAttemptRepository {
  findByIdempotencyKey(key: string): Promise<{
    bookingId: string;
    status: 'succeeded' | 'failed';
    failureReason: string | null;
  } | null>;
  record(input: {
    bookingId: string;
    status: 'succeeded' | 'failed';
    amountCents: number;
    providerRef: string;
    idempotencyKey: string;
    failureReason?: string;
  }): Promise<void>;
}

/** DI tokens. Nest cannot inject an interface, so the ports need symbols. */
export const UNIT_OF_WORK = Symbol('UnitOfWork');
export const BOOKING_REPOSITORY = Symbol('BookingRepository');
export const TRIAL_CLASS_REPOSITORY = Symbol('TrialClassRepository');
export const STUDENT_REPOSITORY = Symbol('StudentRepository');
export const PAYMENT_ATTEMPT_REPOSITORY = Symbol('PaymentAttemptRepository');
