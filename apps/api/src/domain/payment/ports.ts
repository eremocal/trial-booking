export type ChargeResult =
  | { status: 'succeeded'; providerRef: string }
  | { status: 'failed'; providerRef: string; failureReason: string };

/**
 * Port for the payment provider. The domain knows there is a thing that takes
 * money and can give it back; it does not know which company that is.
 */
export interface PaymentGateway {
  charge(input: {
    amountCents: number;
    token: string;
    idempotencyKey: string;
  }): Promise<ChargeResult>;

  refund(input: { providerRef: string; amountCents: number }): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol('PaymentGateway');
