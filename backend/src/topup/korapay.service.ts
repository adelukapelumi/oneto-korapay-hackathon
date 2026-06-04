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
  customerName: string;
  customerEmail: string;
  narration: string;
}

export interface KorapayPayoutResponse {
  status: boolean;
  message?: string;
  data: {
    reference: string;
    status: string;
    fee?: string | number;
    transaction_fee?: string | number;
    processor_fee?: string | number;
    transfer_fee?: string | number;
    payout_fee?: string | number;
  };
}

const KorapayPayoutResponseSchema = z.object({
  status: z.boolean(),
  message: z.string().optional(),
  data: z.object({
    reference: z.string(),
    status: z.string(),
    fee: z.union([z.string(), z.number()]).optional(),
    transaction_fee: z.union([z.string(), z.number()]).optional(),
    processor_fee: z.union([z.string(), z.number()]).optional(),
    transfer_fee: z.union([z.string(), z.number()]).optional(),
    payout_fee: z.union([z.string(), z.number()]).optional(),
  }).passthrough(),
}).passthrough();

export interface KorapayPayoutInitiation {
  reference: string;
  status: string;
  payoutFeeKobo: bigint | null;
  rawResponse: unknown;
}

export interface KorapayBank {
  name: string;
  code: string;
  countryCode: string;
}

export interface ResolveBankAccountParams {
  bankCode: string;
  accountNumber: string;
  currency?: string;
}

export interface KorapayResolvedBankAccount {
  accountName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
}

type KorapayGatewayErrorCategory =
  | 'http_error'
  | 'invalid_response'
  | 'network_error';

export class KorapayGatewayError extends Error {
  readonly statusCode: number | null;
  readonly responseBody: unknown;
  readonly category: KorapayGatewayErrorCategory;

  constructor(input: {
    message: string;
    category: KorapayGatewayErrorCategory;
    statusCode?: number | null;
    responseBody?: unknown;
  }) {
    super(input.message);
    this.name = 'KorapayGatewayError';
    this.category = input.category;
    this.statusCode = input.statusCode ?? null;
    this.responseBody = input.responseBody ?? null;
  }
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

const KorapayBankRecordSchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    code: z.string().trim().min(1).optional(),
    country: z.string().trim().min(1).optional(),
    bank_name: z.string().trim().min(1).optional(),
    bank_code: z.string().trim().min(1).optional(),
    country_code: z.string().trim().min(1).optional(),
    countryCode: z.string().trim().min(1).optional(),
  })
  .passthrough()
  .transform((value, ctx) => {
    const name = value.name ?? value.bank_name;
    const code = value.code ?? value.bank_code;
    const countryCode = value.countryCode ?? value.country_code ?? value.country;

    if (!name || !code || !countryCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Korapay bank record is missing required fields",
      });
      return z.NEVER;
    }

    return {
      name,
      code,
      countryCode,
    } satisfies KorapayBank;
  });

const KorapayListBanksResponseSchema = z
  .object({
    status: z.boolean(),
    data: z.array(KorapayBankRecordSchema),
  })
  .passthrough();

const KorapayResolvedBankAccountSchema = z
  .object({
    account_name: z.string().trim().min(1).optional(),
    account_number: z.string().trim().min(1).optional(),
    bank_name: z.string().trim().min(1).optional(),
    bank_code: z.string().trim().min(1).optional(),
    accountName: z.string().trim().min(1).optional(),
    accountNumber: z.string().trim().min(1).optional(),
    bankName: z.string().trim().min(1).optional(),
    bankCode: z.string().trim().min(1).optional(),
  })
  .passthrough()
  .transform((value, ctx) => {
    const accountName = value.account_name ?? value.accountName;
    const accountNumber = value.account_number ?? value.accountNumber;
    const bankName = value.bank_name ?? value.bankName;
    const bankCode = value.bank_code ?? value.bankCode;

    if (!accountName || !accountNumber || !bankName || !bankCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Korapay bank resolution payload is missing required fields",
      });
      return z.NEVER;
    }

    return {
      accountName,
      accountNumber,
      bankName,
      bankCode,
    } satisfies KorapayResolvedBankAccount;
  });

const KorapayResolveBankAccountResponseSchema = z
  .object({
    status: z.boolean(),
    data: KorapayResolvedBankAccountSchema,
  })
  .passthrough();

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
  private readonly publicKey: string;
  private readonly secretKey: string;
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.publicKey = this.configService.get<string>('KORAPAY_PUBLIC_KEY') || '';
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
      // Pay-in fee policy: the student bears Korapay's checkout fee.
      // Oneto credits only `amountKobo` as Oneto Credits; any Korapay
      // amount_paid/fee above that requested amount is audit data, not value
      // to credit into the closed-loop ledger.
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
          ...this.buildSecretAuthHeaders(),
          'Content-Type': 'application/json',
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

  async initiatePayout(params: InitiatePayoutParams): Promise<KorapayPayoutInitiation> {
    const amountNgn = Number((params.amountKobo / 100).toFixed(2));

    const payload = {
      reference: params.reference,
      destination: {
        type: 'bank_account',
        amount: amountNgn,
        currency: 'NGN',
        narration: params.narration,
        customer: {
          name: params.customerName,
          email: params.customerEmail,
        },
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
          ...this.buildSecretAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseBody = await this.readResponseBody(response);
        this.logger.error(
          `Korapay payout failed with non-2xx response: ${response.status} ${JSON.stringify(responseBody)}`,
        );
        throw new KorapayGatewayError({
          message: `Korapay payout rejected request with HTTP ${response.status}`,
          category: 'http_error',
          statusCode: response.status,
          responseBody,
        });
      }

      const json = await response.json();
      const parsed = KorapayPayoutResponseSchema.safeParse(json);
      if (!parsed.success || !parsed.data.status || !parsed.data.data) {
        this.logger.error(`Korapay payout returned invalid response: ${JSON.stringify(json)}`);
        throw new KorapayGatewayError({
          message: 'Korapay payout returned an invalid response payload',
          category: 'invalid_response',
          statusCode: response.status,
          responseBody: json,
        });
      }

      return {
        reference: parsed.data.data.reference,
        status: parsed.data.data.status,
        payoutFeeKobo: this.extractPayoutFeeKobo(parsed.data.data),
        rawResponse: json,
      };
    } catch (error) {
      if (error instanceof KorapayGatewayError) {
        throw error;
      }
      this.logger.error(`Failed to reach Korapay Payout API: ${error}`);
      throw new KorapayGatewayError({
        message: 'Failed to communicate with payout gateway',
        category: 'network_error',
        responseBody: error instanceof Error ? { message: error.message } : { error: String(error) },
      });
    }
  }

  async listBanks(countryCode: string = 'NG'): Promise<KorapayBank[]> {
    const normalizedCountryCode = countryCode.trim().toUpperCase();

    try {
      this.assertPublicKeyConfigured('bank list');

      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/misc/banks?countryCode=${encodeURIComponent(normalizedCountryCode)}`,
        {
          method: 'GET',
          headers: this.buildPublicAuthHeaders(),
        },
      );

      if (!response.ok) {
        const responseBody = await this.readResponseBody(response);
        throw new KorapayGatewayError({
          message: `Korapay bank list request failed with HTTP ${response.status}`,
          category: 'http_error',
          statusCode: response.status,
          responseBody,
        });
      }

      const json = await response.json();
      const parsed = KorapayListBanksResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new KorapayGatewayError({
          message: 'Korapay bank list returned an invalid response payload',
          category: 'invalid_response',
          statusCode: response.status,
          responseBody: json,
        });
      }

      return parsed.data.data;
    } catch (error) {
      if (error instanceof KorapayGatewayError) {
        throw error;
      }

      throw new KorapayGatewayError({
        message: 'Failed to communicate with Korapay bank list endpoint',
        category: 'network_error',
        responseBody: error instanceof Error ? { message: error.message } : { error: String(error) },
      });
    }
  }

  async resolveBankAccount(
    params: ResolveBankAccountParams,
  ): Promise<KorapayResolvedBankAccount> {
    const currency = (params.currency ?? 'NGN').trim().toUpperCase();
    const payload = {
      bank: params.bankCode,
      account: params.accountNumber,
      currency,
    };

    try {
      this.assertPublicKeyConfigured('bank resolution');

      const response = await this.fetchWithTimeout(`${this.baseUrl}/misc/banks/resolve`, {
        method: 'POST',
        headers: {
          ...this.buildPublicAuthHeaders(),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const responseBody = await this.readResponseBody(response);
        throw new KorapayGatewayError({
          message: `Korapay bank resolution failed with HTTP ${response.status}`,
          category: 'http_error',
          statusCode: response.status,
          responseBody,
        });
      }

      const json = await response.json();
      const parsed = KorapayResolveBankAccountResponseSchema.safeParse(json);
      if (!parsed.success) {
        throw new KorapayGatewayError({
          message: 'Korapay bank resolution returned an invalid response payload',
          category: 'invalid_response',
          statusCode: response.status,
          responseBody: json,
        });
      }

      return parsed.data.data;
    } catch (error) {
      if (error instanceof KorapayGatewayError) {
        throw error;
      }

      throw new KorapayGatewayError({
        message: 'Failed to communicate with Korapay bank resolution endpoint',
        category: 'network_error',
        responseBody: error instanceof Error ? { message: error.message } : { error: String(error) },
      });
    }
  }

  /**
   * Korapay money fields arrive as major NGN values in some responses
   * (for example "25.00" or 25). We convert to integer kobo and return
   * null when the gateway simply did not disclose a fee.
   */
  parseMajorNgnToKobo(value: unknown): bigint | null {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
      if (!match) {
        return null;
      }

      const nairaPart = match[1];
      if (!nairaPart) {
        return null;
      }

      const naira = BigInt(nairaPart);
      const kobo = BigInt((match[2] ?? '').padEnd(2, '0'));
      return naira * 100n + kobo;
    }

    if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < 0) {
        return null;
      }

      const scaled = Math.round(value * 100);
      if (!Number.isSafeInteger(scaled) || Math.abs(value * 100 - scaled) > 1e-9) {
        return null;
      }

      return BigInt(scaled);
    }

    return null;
  }

  extractPayoutFeeKobo(data: unknown): bigint | null {
    const parsed = z
      .object({
        fee: z.unknown().optional(),
        transfer_fee: z.unknown().optional(),
        transaction_fee: z.unknown().optional(),
        processor_fee: z.unknown().optional(),
        payout_fee: z.unknown().optional(),
        transferFee: z.unknown().optional(),
        transactionFee: z.unknown().optional(),
        processorFee: z.unknown().optional(),
        payoutFee: z.unknown().optional(),
      })
      .passthrough()
      .safeParse(data);

    if (!parsed.success) {
      return null;
    }

    const candidates = [
      parsed.data.fee,
      parsed.data.transfer_fee,
      parsed.data.transaction_fee,
      parsed.data.processor_fee,
      parsed.data.payout_fee,
      parsed.data.transferFee,
      parsed.data.transactionFee,
      parsed.data.processorFee,
      parsed.data.payoutFee,
    ];

    for (const candidate of candidates) {
      const parsedFee = this.parseMajorNgnToKobo(candidate);
      if (parsedFee !== null) {
        return parsedFee;
      }
    }

    return null;
  }

  async verifyTransaction(reference: string): Promise<KorapayTransactionVerification> {
    try {
      const response = await this.fetchWithTimeout(`${this.baseUrl}/charges/${encodeURIComponent(reference)}`, {
        method: 'GET',
        headers: this.buildSecretAuthHeaders(),
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

  private buildPublicAuthHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.publicKey}`,
    };
  }

  private buildSecretAuthHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.secretKey}`,
    };
  }

  private assertPublicKeyConfigured(operation: 'bank list' | 'bank resolution'): void {
    if (this.publicKey.trim().length > 0) {
      return;
    }

    throw new KorapayGatewayError({
      message: `Korapay public key missing for ${operation}`,
      category: 'network_error',
      responseBody: { code: 'missing_korapay_public_key' },
    });
  }

  private async readResponseBody(response: Response): Promise<unknown> {
    const rawText = await response.text();
    if (rawText.length === 0) {
      return null;
    }

    try {
      return JSON.parse(rawText) as unknown;
    } catch {
      return rawText;
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
