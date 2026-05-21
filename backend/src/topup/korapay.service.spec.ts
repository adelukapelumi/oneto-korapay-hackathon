import { Test, TestingModule } from '@nestjs/testing';
import { KorapayService } from './korapay.service';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { InternalServerErrorException } from '@nestjs/common';

describe('KorapayService', () => {
  let service: KorapayService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KorapayService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'KORAPAY_SECRET_KEY') return 'sk_test_123';
              if (key === 'KORAPAY_BASE_URL') return 'https://api.korapay.com/merchant/api/v1';
              return null;
            }),
          },
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
          customer: { email: 'test@cu.edu.ng', name: 'Test User' },
        }),
      }));
      expect(result.paymentUrl).toBe('https://checkout.korapay.com/xxx');
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
            amount_paid: '500.00',
            currency: 'NGN',
          },
        }),
      } as Response);

      await expect(service.verifyTransaction('top_123')).resolves.toEqual({
        status: 'success',
        reference: 'top_123',
        amount: '500.00',
        amountPaid: '500.00',
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
