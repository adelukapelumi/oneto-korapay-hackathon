import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { z } from 'zod';

export interface InitiateCheckoutParams {
  amountKobo: number;
  reference: string;
  customerEmail: string;
  customerName?: string;
}

export interface KorapayCheckoutResponse {
  status: boolean;
  message: string;
  data: {
    checkout_url?: string | null;
    reference?: string | null;
  };
}

export interface InitiatePayoutParams {
  reference: string;
  amountKobo: number;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  narration: string;
}

export interface KorapayPayoutResponse {
  status: boolean;
  message: string;
  data: {
    reference: string;
    status: string;
  };
}

const KorapayVerifyTransactionResponseSchema = z.object({
  status: z.boolean(),
  data: z.object({
    reference: z.string().optional(),
    status: z.string(),
    amount: z.union([z.string(), z.number()]).optional(),
    amount_paid: z.union([z.string(), z.number()]).optional(),
    fee: z.union([z.string(), z.number()]).optional(),
    transaction_fee: z.union([z.string(), z.number()]).optional(),
    processor_fee: z.union([z.string(), z.number()]).optional(),
    merchant_bears_cost: z.boolean().optional(),
    currency: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

export interface KorapayTransactionVerification {
  status: string;
  reference?: string;
  amount?: string | number;
  amountPaid?: string | number;
  fee?: string | number;
  transactionFee?: string | number;
  processorFee?: string | number;
  merchantBearsCost?: boolean;
  currency?: string;
}

const KORAPAY_FETCH_TIMEOUT_MS = 10_000;

@Injectable()
export class KorapayService {
  private readonly logger = new Logger(KorapayService.name);
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.secretKey = this.configService.get<string>('KORAPAY_SECRET_KEY') || '';
    this.baseUrl = this.configService.get<string>('KORAPAY_BASE_URL') || 'https://api.korapay.com/merchant/api/v1';
  }

  /**
   * Korapay signs ONLY the `data` object, re-stringified with their secret key.
   * Per docs: https://developers.korapay.com/docs/webhooks
   * NOT the raw request body. Auditors may flag this as an anti-pattern — it follows Korapay's official contract.
   */

  verifyWebhookSignature(dataObject: unknown, signatureHeader: string | undefined): boolean {
    if (!signatureHeader || !this.secretKey || !dataObject) {
      return false;
    }

    const payloadString = JSON.stringify(dataObject);
    const expectedSignature = crypto
      .createHmac('sha256', this.secretKey)
      .update(payloadString)
      .digest('hex');

    if (expectedSignature.length !== signatureHeader.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature),
        Buffer.from(signatureHeader)
      );
    } catch {
      return false;
    }
  }

  async initiateCheckout(params: InitiateCheckoutParams): Promise<{ paymentUrl: string }> {
    const amountNgn = params.amountKobo / 100;

    const payload = {
      amount: amountNgn,
      reference: params.reference,
      currency: 'NGN',
      merchant_bears_cost: false,
      customer: {
        email: params.customerEmail,
        name: params.customerName || 'Oneto User',
      },
    };

    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/charges/initialize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Korapay initiate failed: ${response.status} ${errorText}`);
        throw new InternalServerErrorException('Payment gateway error');
      }

      const json = await response.json() as KorapayCheckoutResponse;
      if (!json.status || !json.data?.checkout_url) {
        this.logger.error(`Korapay returned invalid response format: ${JSON.stringify(json)}`);
        throw new InternalServerErrorException('Invalid payment gateway response');
      }

      const checkoutUrl = this.validateCheckoutUrl(json.data.checkout_url, params.reference);
      this.logger.log(
        `Korapay checkout initialized for reference ${params.reference} host=${checkoutUrl.hostname}`,
      );

      return { paymentUrl: checkoutUrl.toString() };
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Failed to reach Korapay API: ${error}`);
      throw new InternalServerErrorException('Failed to communicate with payment gateway');
    }
  }

  async initiatePayout(params: InitiatePayoutParams): Promise<{ reference: string; status: string }> {
    const amountNgn = Number((params.amountKobo / 100).toFixed(2));

    const payload = {
      reference: params.reference,
      destination: {
        type: 'bank_account',
        amount: amountNgn,
        currency: 'NGN',
        narration: params.narration,
        bank_account: {
          bank: params.bankCode,
          account: params.accountNumber,
        },
      },
    };

    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/transactions/disburse`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.secretKey}`,
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`Korapay payout failed: ${response.status} ${errorText}`);
        throw new InternalServerErrorException('Payout failed');
      }

      const json = (await response.json()) as KorapayPayoutResponse;
      if (!json.status || !json.data) {
        this.logger.error(`Korapay payout returned invalid response: ${JSON.stringify(json)}`);
        throw new InternalServerErrorException('Invalid payout response');
      }

      return {
        reference: json.data.reference,
        status: json.data.status,
      };
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Failed to reach Korapay Payout API: ${error}`);
      throw new InternalServerErrorException('Failed to communicate with payment gateway');
    }
  }

  async verifyTransaction(reference: string): Promise<KorapayTransactionVerification> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/charges/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.secretKey}`,
        },
      });

      if (!response.ok) {
        if (response.status === 404) {
          return { status: 'not_found' };
        }
        const errorText = await response.text();
        this.logger.error(`Korapay verify charge failed: ${response.status} ${errorText}`);
        throw new InternalServerErrorException('Verify transaction failed');
      }

      const json = await response.json();
      const parsed = KorapayVerifyTransactionResponseSchema.safeParse(json);
      if (!parsed.success || !parsed.data.status || !parsed.data.data) {
        throw new InternalServerErrorException('Invalid verification response');
      }

      return {
        status: parsed.data.data.status,
        reference: parsed.data.data.reference,
        amount: parsed.data.data.amount,
        amountPaid: parsed.data.data.amount_paid,
        fee: parsed.data.data.fee,
        transactionFee: parsed.data.data.transaction_fee,
        processorFee: parsed.data.data.processor_fee,
        merchantBearsCost: parsed.data.data.merchant_bears_cost,
        currency: parsed.data.data.currency,
      };
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Failed to verify Korapay transaction ${reference}: ${error}`);
      throw new InternalServerErrorException('Failed to verify transaction');
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number = KORAPAY_FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    // Preserve upstream cancellation if a signal is already provided.
    let removeExternalAbortListener: (() => void) | undefined;
    if (init.signal) {
      if (init.signal.aborted) {
        controller.abort();
      } else {
        const onAbort = () => controller.abort();
        init.signal.addEventListener('abort', onAbort, { once: true });
        removeExternalAbortListener = () => {
          init.signal?.removeEventListener('abort', onAbort);
        };
      }
    }

    try {
      return await fetch(url, {
        ...init,
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Korapay request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      removeExternalAbortListener?.();
    }
  }

  private validateCheckoutUrl(rawCheckoutUrl: string, reference: string): URL {
    let checkoutUrl: URL;

    try {
      checkoutUrl = new URL(rawCheckoutUrl);
    } catch {
      this.logger.error(`Korapay returned an invalid checkout URL for reference ${reference}`);
      throw new InternalServerErrorException('Invalid payment gateway response');
    }

    if (checkoutUrl.protocol !== 'https:' || checkoutUrl.hostname.length === 0) {
      this.logger.error(
        `Korapay returned a non-HTTPS or hostless checkout URL for reference ${reference}`,
      );
      throw new InternalServerErrorException('Invalid payment gateway response');
    }

    return checkoutUrl;
  }

  // TODO post-pilot: initiateVirtualAccount()
}
