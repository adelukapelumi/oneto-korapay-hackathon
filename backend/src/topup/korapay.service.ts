import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

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
    checkout_url: string;
    reference: string;
  };
}

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
      customer: {
        email: params.customerEmail,
        name: params.customerName || 'Oneto User',
      },
    };

    try {
      const response = await fetch(`${this.baseUrl}/charges/initialize`, {
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

      return { paymentUrl: json.data.checkout_url };
    } catch (error) {
      if (error instanceof InternalServerErrorException) {
        throw error;
      }
      this.logger.error(`Failed to reach Korapay API: ${error}`);
      throw new InternalServerErrorException('Failed to communicate with payment gateway');
    }
  }

  // TODO post-pilot: initiateVirtualAccount()
}
