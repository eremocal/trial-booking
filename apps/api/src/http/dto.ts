import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateBookingDto {
  @IsUUID()
  studentId!: string;

  @IsUUID()
  trialClassId!: string;
}

export class PayBookingDto {
  /**
   * Supplied by the client so a retried request is recognisable as the same
   * attempt. Required, not optional: making it optional means the one caller
   * who forgets it is the one who double-charges a parent.
   */
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  idempotencyKey!: string;

  /** Mock payment-method token. See MockPaymentGateway.TOKENS. */
  @IsString()
  @MaxLength(64)
  token!: string;
}
