import { Injectable, Logger } from '@nestjs/common';
import type { ChargeResult, PaymentGateway } from '../../domain/payment/ports';

/**
 * A fake payment provider. Outcomes are driven by the token rather than by
 * randomness, so every failure path is reproducible in tests and the demo.
 */
@Injectable()
export class MockPaymentGateway implements PaymentGateway {
  private readonly logger = new Logger(MockPaymentGateway.name);

  static readonly TOKENS = {
    /** Always succeeds. */
    OK: 'tok_ok',
    /** Always declined by the issuer. */
    DECLINED: 'tok_declined',
    /** Declined for insufficient funds. */
    INSUFFICIENT: 'tok_insufficient_funds',
    /** The provider itself errors -- network/5xx, outcome genuinely unknown. */
    ERROR: 'tok_gateway_error',
    /** Succeeds after a short delay. */
    SLOW: 'tok_slow',
  } as const;

  async charge(input: {
    amountCents: number;
    token: string;
    idempotencyKey: string;
  }): Promise<ChargeResult> {
    const ref = `mock_pi_${input.idempotencyKey.slice(0, 24)}`;

    switch (input.token) {
      case MockPaymentGateway.TOKENS.DECLINED:
        return { status: 'failed', providerRef: ref, failureReason: 'card_declined' };

      case MockPaymentGateway.TOKENS.INSUFFICIENT:
        return { status: 'failed', providerRef: ref, failureReason: 'insufficient_funds' };

      case MockPaymentGateway.TOKENS.ERROR:
        // Thrown, not returned: the caller does NOT know whether money moved.
        // This is the case that makes idempotency keys necessary.
        throw new Error('mock gateway: upstream unavailable');

      case MockPaymentGateway.TOKENS.SLOW:
        await new Promise((r) => setTimeout(r, 150));
        return { status: 'succeeded', providerRef: ref };

      default:
        return { status: 'succeeded', providerRef: ref };
    }
  }

  async refund(input: { providerRef: string; amountCents: number }): Promise<void> {
    // A real implementation calls the provider; this only logs the refund.
    this.logger.log(
      `refunded ${input.amountCents} cents against ${input.providerRef}`,
    );
  }
}
