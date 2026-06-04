import { Test, TestingModule } from '@nestjs/testing';
import { KorapayGatewayError, KorapayService } from './korapay.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';

describe('KorapayService', () => {
  let service: KorapayService;
  let configService: { get: jest.Mock };

  beforeEach(async () => {
    configService = {
      get: jest.fn((key: string) => {
        if (key === 'KORAPAY_PUBLIC_KEY') return 'pk_test_123';
        if (key === 'KORAPAY_SECRET_KEY') return 'sk_test_123';
        if (key === 'KORAPAY_BASE_URL') return 'https://api.korapay.com/merchant/api/v1';
        return null;
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KorapayService,
        {
          provide: ConfigService,
          useValue: configService,
        },
      ],
    }).compile();

    service = module.get<KorapayService>(KorapayService);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('verifyWebhookSignature', () => {
    it('returns true for correctly-signed body', () => {
      const data = { amount: 100 };
      const signature = crypto.createHmac('sha256', 'sk_test_123').update(JSON.stringify(data)).digest('hex');
      
      const result = service.verifyWebhookSignature(data, signature);
      
      expect(result).toBe(true);
    });

    it('returns false for tampered body', () => {
      const data = { amount: 100 };
      const signature = crypto.createHmac('sha256', 'sk_test_123').update(JSON.stringify(data)).digest('hex');
      
      const tamperedData = { amount: 999 };
      const result = service.verifyWebhookSignature(tamperedData, signature);
      
      expect(result).toBe(false);
    });

    it('returns false for tampered signature', () => {
      const data = { amount: 100 };
      const signature = crypto.createHmac('sha256', 'sk_test_123').update(JSON.stringify(data)).digest('hex');
      
      // Tamper by changing last char
      const tamperedSignature = signature.slice(0, -1) + (signature.endsWith('a') ? 'b' : 'a');
      const result = service.verifyWebhookSignature(data, tamperedSignature);
      
      expect(result).toBe(false);
    });

    it('returns false when signature header is missing/empty', () => {
      const data = { amount: 100 };
      expect(service.verifyWebhookSignature(data, undefined)).toBe(false);
      expect(service.verifyWebhookSignature(data, '')).toBe(false);
    });
  });

  describe('initiateCheckout', () => {
    it('sends correct Authorization header and body shape to Korapay', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: { checkout_url: 'https://checkout.korapay.com/xxx', reference: 'top_123' },
        }),
      } as Response);

      const result = await service.initiateCheckout({
        amountKobo: 15000,
        reference: 'top_123',
        customerEmail: 'test@cu.edu.ng',
        customerName: 'Test User',
      });

      expect(fetchSpy).toHaveBeenCalledWith('https://api.korapay.com/merchant/api/v1/charges/initialize', expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer sk_test_123',
        },
        body: JSON.stringify({
          amount: 150,
          reference: 'top_123',
          currency: 'NGN',
          merchant_bears_cost: false,
          customer: { email: 'test@cu.edu.ng', name: 'Test User' },
        }),
      }));
      expect(result.paymentUrl).toBe('https://checkout.korapay.com/xxx');
    });

    it('sends merchant_bears_cost false so students pay Korapay processing fees', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: { checkout_url: 'https://checkout.korapay.com/xxx', reference: 'top_123' },
        }),
      } as Response);

      await service.initiateCheckout({
        amountKobo: 100_000,
        reference: 'top_123',
        customerEmail: 'student@cu.edu.ng',
      });

      const requestInit = fetchSpy.mock.calls[0]?.[1];
      if (!requestInit?.body || typeof requestInit.body !== 'string') {
        throw new Error('Expected JSON checkout payload');
      }

      expect(JSON.parse(requestInit.body)).toEqual(
        expect.objectContaining({
          amount: 1000,
          merchant_bears_cost: false,
        }),
      );
    });

    it('rejects an invalid checkout URL returned by Korapay', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: { checkout_url: 'not-a-valid-url', reference: 'top_123' },
        }),
      } as Response);

      await expect(service.initiateCheckout({
        amountKobo: 15_000,
        reference: 'top_123',
        customerEmail: 'test@cu.edu.ng',
      })).rejects.toThrow(InternalServerErrorException);
    });

    it('rejects a non-HTTPS checkout URL returned by Korapay', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: { checkout_url: 'http://checkout.korapay.com/xxx', reference: 'top_123' },
        }),
      } as Response);

      await expect(service.initiateCheckout({
        amountKobo: 15_000,
        reference: 'top_123',
        customerEmail: 'test@cu.edu.ng',
      })).rejects.toThrow(InternalServerErrorException);
    });

    it('throws on non-2xx response from Korapay', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => 'Bad Request',
      } as Response);

      await expect(service.initiateCheckout({
        amountKobo: 15000,
        reference: 'top_123',
        customerEmail: 'test@cu.edu.ng',
      })).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('verifyTransaction', () => {
    it('returns normalized verification fields from Korapay', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            reference: 'top_123',
            status: 'success',
            amount: '500.00',
            amount_paid: '514.00',
            fee: '14.00',
            transaction_fee: '14.00',
            processor_fee: '14.00',
            merchant_bears_cost: false,
            currency: 'NGN',
          },
        }),
      } as Response);

      await expect(service.verifyTransaction('top_123')).resolves.toEqual({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '514.00',
        fee: '14.00',
        transactionFee: '14.00',
        processorFee: '14.00',
        merchantBearsCost: false,
        currency: 'NGN',
      });
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.korapay.com/merchant/api/v1/charges/top_123',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer sk_test_123',
          },
        }),
      );
      expect(fetchSpy.mock.calls[0]?.[0]).not.toContain('/transactions/');
    });

    it('returns not_found for a missing reference', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 404,
      } as Response);

      await expect(service.verifyTransaction('missing_ref')).resolves.toEqual({
        status: 'not_found',
      });
    });
  });

  describe('initiatePayout', () => {
    it('returns optional payout fee from Korapay response as integer kobo', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            reference: 'cashout_ref',
            status: 'processing',
            fee: '25.00',
          },
        }),
      } as Response);

      await expect(service.initiatePayout({
        reference: 'cashout_ref',
        amountKobo: 97500,
        bankCode: '035',
        accountNumber: '1234567890',
        accountName: 'Campus Cafe',
        customerName: 'Campus Cafe',
        customerEmail: 'merchant@cu.edu.ng',
        narration: 'Cashout cashout_ref',
      })).resolves.toEqual({
        reference: 'cashout_ref',
        status: 'processing',
        payoutFeeKobo: 2500n,
        rawResponse: {
          status: true,
          data: {
            reference: 'cashout_ref',
            status: 'processing',
            fee: '25.00',
          },
        },
      });

      const requestInit = fetchSpy.mock.calls[0]?.[1];
      if (!requestInit?.body || typeof requestInit.body !== 'string') {
        throw new Error('Expected JSON payout payload');
      }
      expect(JSON.parse(requestInit.body)).toEqual(
        expect.objectContaining({
          reference: 'cashout_ref',
          destination: expect.objectContaining({
            amount: 975,
            customer: {
              name: 'Campus Cafe',
              email: 'merchant@cu.edu.ng',
            },
          }),
        }),
      );
      expect(requestInit.headers).toEqual({
        'Content-Type': 'application/json',
        Authorization: 'Bearer sk_test_123',
      });
    });

    it('allows payout response without fee and records fee as unknown', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            reference: 'cashout_ref',
            status: 'processing',
          },
        }),
      } as Response);

      await expect(service.initiatePayout({
        reference: 'cashout_ref',
        amountKobo: 97500,
        bankCode: '035',
        accountNumber: '1234567890',
        accountName: 'Campus Cafe',
        customerName: 'Campus Cafe',
        customerEmail: 'merchant@cu.edu.ng',
        narration: 'Cashout cashout_ref',
      })).resolves.toMatchObject({
        reference: 'cashout_ref',
        status: 'processing',
        payoutFeeKobo: null,
      });
    });

    it('parses string and number major-NGN fee fields safely', () => {
      expect(service.parseMajorNgnToKobo('25.50')).toBe(2550n);
      expect(service.parseMajorNgnToKobo(25.5)).toBe(2550n);
      expect(service.parseMajorNgnToKobo('25.555')).toBeNull();
      expect(service.extractPayoutFeeKobo({ transfer_fee: '30.00' })).toBe(3000n);
    });

    it('throws KorapayGatewayError with status and body on non-2xx payout response', async () => {
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: false,
        status: 422,
        text: async () =>
          JSON.stringify({
            status: false,
            message: 'Account number is invalid',
            code: 'invalid_account',
          }),
      } as Response);

      await expect(
        service.initiatePayout({
          reference: 'cashout_ref',
          amountKobo: 97500,
          bankCode: '035',
          accountNumber: '1234567890',
          accountName: 'Campus Cafe',
          customerName: 'Campus Cafe',
          customerEmail: 'merchant@cu.edu.ng',
          narration: 'Cashout cashout_ref',
        }),
      ).rejects.toMatchObject({
        name: 'KorapayGatewayError',
        statusCode: 422,
        category: 'http_error',
        responseBody: expect.objectContaining({
          code: 'invalid_account',
        }),
      } satisfies Partial<KorapayGatewayError>);
    });
  });

  describe('listBanks', () => {
    it('calls Korapay bank list endpoint with the public key and returns only safe bank fields', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: [
            {
              name: 'Wema Bank',
              code: '035',
              countryCode: 'NG',
              slug: 'wema-bank',
            },
          ],
        }),
      } as Response);

      await expect(service.listBanks()).resolves.toEqual([
        {
          name: 'Wema Bank',
          code: '035',
          countryCode: 'NG',
        },
      ]);

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.korapay.com/merchant/api/v1/misc/banks?countryCode=NG',
        expect.objectContaining({
          method: 'GET',
          headers: {
            Authorization: 'Bearer pk_test_123',
          },
        }),
      );
    });

    it('fails safely when the Korapay public key is missing', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'KORAPAY_PUBLIC_KEY') return '';
        if (key === 'KORAPAY_SECRET_KEY') return 'sk_test_123';
        if (key === 'KORAPAY_BASE_URL') return 'https://api.korapay.com/merchant/api/v1';
        return null;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KorapayService,
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const serviceWithoutPublicKey = module.get<KorapayService>(KorapayService);

      await expect(serviceWithoutPublicKey.listBanks()).rejects.toMatchObject({
        name: 'KorapayGatewayError',
        category: 'network_error',
        responseBody: { code: 'missing_korapay_public_key' },
      } satisfies Partial<KorapayGatewayError>);
    });
  });

  describe('resolveBankAccount', () => {
    it('sends bank, account and currency to Korapay with the public key and returns normalized account details', async () => {
      const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({
          status: true,
          data: {
            account_name: 'Campus Cafe Ltd',
            account_number: '1234567890',
            bank_name: 'Wema Bank',
            bank_code: '035',
          },
        }),
      } as Response);

      await expect(
        service.resolveBankAccount({
          bankCode: '035',
          accountNumber: '1234567890',
        }),
      ).resolves.toEqual({
        accountName: 'Campus Cafe Ltd',
        accountNumber: '1234567890',
        bankName: 'Wema Bank',
        bankCode: '035',
      });

      const requestInit = fetchSpy.mock.calls[0]?.[1];
      if (!requestInit?.body || typeof requestInit.body !== 'string') {
        throw new Error('Expected JSON bank resolve payload');
      }

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.korapay.com/merchant/api/v1/misc/banks/resolve',
        expect.objectContaining({
          method: 'POST',
          headers: {
            Authorization: 'Bearer pk_test_123',
            'Content-Type': 'application/json',
          },
        }),
      );
      expect(JSON.parse(requestInit.body)).toEqual({
        bank: '035',
        account: '1234567890',
        currency: 'NG',
      });
    });

    it('fails safely when the Korapay public key is missing for account resolution', async () => {
      configService.get.mockImplementation((key: string) => {
        if (key === 'KORAPAY_PUBLIC_KEY') return '';
        if (key === 'KORAPAY_SECRET_KEY') return 'sk_test_123';
        if (key === 'KORAPAY_BASE_URL') return 'https://api.korapay.com/merchant/api/v1';
        return null;
      });

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          KorapayService,
          {
            provide: ConfigService,
            useValue: configService,
          },
        ],
      }).compile();

      const serviceWithoutPublicKey = module.get<KorapayService>(KorapayService);

      await expect(
        serviceWithoutPublicKey.resolveBankAccount({
          bankCode: '035',
          accountNumber: '1234567890',
        }),
      ).rejects.toMatchObject({
        name: 'KorapayGatewayError',
        category: 'network_error',
        responseBody: { code: 'missing_korapay_public_key' },
      } satisfies Partial<KorapayGatewayError>);
    });
  });

  describe('fetchWithTimeout', () => {
    it('aborts hanging fetch and rejects with controlled timeout error', async () => {
      jest.useFakeTimers();
      jest.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => {
        return new Promise<Response>((_resolve, reject) => {
          const abortError = new Error('aborted');
          abortError.name = 'AbortError';
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(abortError);
            },
            { once: true },
          );
        });
      });

      const fetchWithTimeout = (service as unknown as Record<string, unknown>)['fetchWithTimeout'] as (
        url: string,
        init: RequestInit,
        timeoutMs?: number,
      ) => Promise<Response>;
      const promise = fetchWithTimeout(
        'https://api.korapay.com/test',
        { method: 'GET' },
        50,
      );
      const assertion = expect(promise).rejects.toThrow('Korapay request timed out after 50ms');

      await jest.advanceTimersByTimeAsync(50);
      await assertion;
    });

    it('clears timeout timer on successful response', async () => {
      jest.useFakeTimers();
      jest.spyOn(globalThis, 'fetch').mockResolvedValue({
        ok: true,
        json: async () => ({ status: true }),
      } as Response);
      const clearTimeoutSpy = jest.spyOn(globalThis, 'clearTimeout');
      const fetchWithTimeout = (service as unknown as Record<string, unknown>)['fetchWithTimeout'] as (
        url: string,
        init: RequestInit,
        timeoutMs?: number,
      ) => Promise<Response>;

      await fetchWithTimeout(
        'https://api.korapay.com/test',
        { method: 'GET' },
        1000,
      );

      expect(clearTimeoutSpy).toHaveBeenCalledTimes(1);
    });
  });
});
