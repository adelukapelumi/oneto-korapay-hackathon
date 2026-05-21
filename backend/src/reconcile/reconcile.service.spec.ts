import { Test, TestingModule } from '@nestjs/testing';
import { ReconcileService } from './reconcile.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  generateKeypair,
  signEnvelope,
  EnvelopeDraft,
  MAX_OFFLINE_TRANSACTION_KOBO,
  MAX_USER_BALANCE_KOBO,
  toKobo,
  toUserId,
  toTransactionId,
  TransactionEnvelope,
} from '@oneto/shared';
import { DeviceKeyStatus, Prisma } from '@prisma/client';

describe('ReconcileService', () => {
  let service: ReconcileService;
  let prisma: PrismaService;

  const mockPrisma: any = {
    $transaction: jest.fn((callback) => callback(mockPrisma)),
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    processedSequence: {
      create: jest.fn(),
      findUnique: jest.fn(),
    },
    ledgerEntry: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    userDeviceKey: {
      findUnique: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.useRealTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReconcileService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ReconcileService>(ReconcileService);
    prisma = module.get<PrismaService>(PrismaService);
    jest.clearAllMocks();
    mockPrisma.userDeviceKey.findUnique.mockImplementation((args: any) => {
      const lookup = args?.where?.userId_publicKey;
      if (!lookup) {
        return Promise.resolve(null);
      }

      return Promise.resolve(
        createTestDeviceKey(lookup.publicKey, DeviceKeyStatus.ACTIVE),
      );
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  // Helpers
  const createTestUser = (id: string, publicKey: string, balance: number = 1000000, role: 'STUDENT' | 'MERCHANT' = 'MERCHANT') => ({
    id,
    publicKey,
    verifiedBalanceKobo: BigInt(balance),
    status: 'ACTIVE',
    role,
  });

  const createTestDeviceKey = (
    publicKey: string,
    status: DeviceKeyStatus = DeviceKeyStatus.ACTIVE,
    overrides?: {
      retiredAt?: Date | null;
      verifyUntil?: Date | null;
    },
  ) => ({
    id: 'dk_test',
    userId: senderId,
    publicKey,
    status,
    retiredAt: overrides?.retiredAt ?? null,
    verifyUntil: overrides?.verifyUntil ?? null,
  });

  const createValidEnvelopeDraft = (
    senderId: string,
    recipientId: string,
    publicKey: string,
    amount: number = 1000,
  ): EnvelopeDraft => {
    const now = Date.now();
    return {
      version: 1,
      senderUserId: toUserId(senderId),
      senderPublicKey: publicKey as any,
      recipientUserId: toUserId(recipientId),
      amountKobo: toKobo(amount),
      senderSequenceNumber: 1,
      senderBalanceBeforeKobo: toKobo(1000000),
      senderBalanceAfterKobo: toKobo(1000000 - amount),
      timestamp: new Date(now).toISOString(),
      expiresAt: new Date(now + 60000).toISOString(),
      requestNonce: 'a'.repeat(32),
    };
  };

  const senderKey = generateKeypair();
  const recipientId = 'u_0000000000000002';
  const senderId = 'u_0000000000000001';

  it('1. Happy path: valid envelope -> success', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toEqual({ transactionId: envelope.transactionId, status: 'success' });
    expect(mockPrisma.processedSequence.create).toHaveBeenCalled();
    expect(mockPrisma.ledgerEntry.create).toHaveBeenCalledTimes(2);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
  });

  it('2. Identity mismatch: auth user !== recipientUserId', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    const result = await service.reconcileOneInternal('u_0000000000000003', envelope);

    expect(result).toMatchObject({ status: 'rejected', reason: 'identity_mismatch' });
  });

  it('3. Sender unknown: senderUserId not in DB', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect((result as any).status).toBe('rejected');
    expect(result).toMatchObject({ reason: 'sender_unknown' });
  });

  it('4. rejects unknown sender public key', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, 'ed25519:' + 'b'.repeat(64)));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.userDeviceKey.findUnique.mockResolvedValue(null);

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toMatchObject({ status: 'rejected', reason: 'public_key_unknown' });
  });

  it('returns generic invalid_envelope to public reconcile() callers for unknown sender public key', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, 'ed25519:' + 'b'.repeat(64)));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.userDeviceKey.findUnique.mockResolvedValue(null);

    const result = await service.reconcile(recipientId, [envelope]);

    expect(result).toEqual([
      {
        transactionId: envelope.transactionId,
        status: 'rejected',
        reason: 'invalid_envelope',
      },
    ]);
  });

  it('accepts envelope signed by an ACTIVE key', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, 'ed25519:' + 'a'.repeat(64)));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.userDeviceKey.findUnique.mockResolvedValue(
      createTestDeviceKey(senderKey.publicKeyString, DeviceKeyStatus.ACTIVE),
    );

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toEqual({ transactionId: envelope.transactionId, status: 'success' });
  });

  it('accepts envelope signed by a VERIFY_ONLY key when timestamp is before retiredAt and verifyUntil has not passed', async () => {
    const fixedNow = new Date('2026-05-21T03:00:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);

    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft.timestamp = '2026-05-21T02:59:30.000Z';
    draft.expiresAt = '2026-05-21T03:00:30.000Z';
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, 'ed25519:' + 'a'.repeat(64)));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.userDeviceKey.findUnique.mockResolvedValue(
      createTestDeviceKey(senderKey.publicKeyString, DeviceKeyStatus.VERIFY_ONLY, {
        retiredAt: new Date('2026-05-21T02:59:45.000Z'),
        verifyUntil: new Date('2026-05-22T03:00:00.000Z'),
      }),
    );

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toEqual({ transactionId: envelope.transactionId, status: 'success' });
  });

  it('rejects VERIFY_ONLY key when envelope timestamp is after retiredAt', async () => {
    const fixedNow = new Date('2026-05-21T03:05:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);

    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft.timestamp = '2026-05-21T03:04:30.000Z';
    draft.expiresAt = '2026-05-21T03:05:30.000Z';
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, 'ed25519:' + 'a'.repeat(64)));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.userDeviceKey.findUnique.mockResolvedValue(
      createTestDeviceKey(senderKey.publicKeyString, DeviceKeyStatus.VERIFY_ONLY, {
        retiredAt: new Date('2026-05-21T03:04:00.000Z'),
        verifyUntil: new Date('2026-05-22T03:05:00.000Z'),
      }),
    );

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'verify_only_envelope_after_retired_at',
    });
  });

  it('rejects VERIFY_ONLY key after verifyUntil has passed', async () => {
    const fixedNow = new Date('2026-05-21T03:10:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);

    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft.timestamp = '2026-05-21T03:09:30.000Z';
    draft.expiresAt = '2026-05-21T03:10:30.000Z';
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, 'ed25519:' + 'a'.repeat(64)));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.userDeviceKey.findUnique.mockResolvedValue(
      createTestDeviceKey(senderKey.publicKeyString, DeviceKeyStatus.VERIFY_ONLY, {
        retiredAt: new Date('2026-05-21T03:09:45.000Z'),
        verifyUntil: new Date('2026-05-21T03:09:50.000Z'),
      }),
    );

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'verify_only_window_expired',
    });
  });

  it('rejects REVOKED sender keys', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, 'ed25519:' + 'a'.repeat(64)));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.userDeviceKey.findUnique.mockResolvedValue(
      createTestDeviceKey(senderKey.publicKeyString, DeviceKeyStatus.REVOKED),
    );

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toMatchObject({ status: 'rejected', reason: 'public_key_revoked' });
  });

  it('5. Timestamp too old (past skew)', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft.timestamp = new Date(Date.now() - 300000).toISOString(); // 5 min ago
    draft.expiresAt = new Date(Date.now() - 240000).toISOString(); 
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockResolvedValue(createTestUser(senderId, senderKey.publicKeyString));

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toMatchObject({ status: 'rejected', reason: 'timestamp_out_of_window' });
  });

  it('6. Timestamp too new (future skew)', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft.timestamp = new Date(Date.now() + 300000).toISOString(); // 5 min future
    draft.expiresAt = new Date(Date.now() + 360000).toISOString();
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockResolvedValue(createTestUser(senderId, senderKey.publicKeyString));

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toMatchObject({ status: 'rejected', reason: 'timestamp_out_of_window' });
  });

  it('7. Expired: expiresAt in the past', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft.timestamp = new Date(Date.now() - 20000).toISOString();
    draft.expiresAt = new Date(Date.now() - 10000).toISOString(); // expired 10s ago, TTL 10s
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockResolvedValue(createTestUser(senderId, senderKey.publicKeyString));

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toMatchObject({ status: 'rejected', reason: 'envelope_expired' });
  });

  it('8. Amount zero', async () => {
    // schema validation will catch this
    const envelope: any = {
      version: 1,
      senderUserId: senderId,
      senderPublicKey: senderKey.publicKeyString,
      recipientUserId: recipientId,
      amountKobo: 0,
      senderSequenceNumber: 1,
      senderBalanceBeforeKobo: 100,
      senderBalanceAfterKobo: 100,
      timestamp: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      requestNonce: 'a'.repeat(32),
      transactionId: toTransactionId('tx_1234567890123456'),
      signature: 'ed25519:' + '0'.repeat(128),
    };

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result?.status).toBe('rejected');
    expect((result as any).reason).toBe('schema_invalid');
  });

  it('9. Amount negative', async () => {
    const envelope: any = {
      ...createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString),
      amountKobo: -100,
      transactionId: toTransactionId('tx_1234567890123456'),
      signature: 'ed25519:' + '0'.repeat(128),
    };

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result?.status).toBe('rejected');
  });

  it('10. Amount over limit', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString, MAX_OFFLINE_TRANSACTION_KOBO + 1);
    // bypass signEnvelope internal validation to create a "valid" signature for a "bad" envelope
    const envelope = {
        ...draft,
        transactionId: toTransactionId('tx_1234567890123456'),
        signature: 'ed25519:' + '0'.repeat(128)
    };

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result?.status).toBe('rejected');
  });

  it('11. Balance math wrong', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft.senderBalanceAfterKobo = toKobo(draft.senderBalanceBeforeKobo - draft.amountKobo + 1);
    
    const envelope = {
        ...draft,
        transactionId: toTransactionId('tx_1234567890123456'),
        signature: 'ed25519:' + '0'.repeat(128)
    };

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result?.status).toBe('rejected');
    expect((result as any).reason).toBe('schema_invalid');
  });

  it('12. Signature invalid', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);
    // Tamper with signature
    (envelope as any).signature = 'ed25519:' + 'f'.repeat(128);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'signature_invalid' });
  });

  it('13. Insufficient server balance', async () => {
    const amount = 5000;
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString, amount);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    // User only has 4000 in DB
    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString, 4000));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'insufficient_balance' });
  });

  it('14. Account frozen', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) {
        const user = createTestUser(senderId, senderKey.publicKeyString);
        user.status = 'FROZEN';
        return Promise.resolve(user);
      }
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'account_frozen' });
  });

  it('15. Replay attack: same envelope submitted twice (idempotent)', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    // Simulate P2002 error on second call
    mockPrisma.processedSequence.create
      .mockResolvedValueOnce({}) // first call succeeds
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Duplicate', {
          code: 'P2002',
          clientVersion: '5.x',
          meta: { target: ['userId', 'sequenceNumber'] },
        }),
      );
    mockPrisma.processedSequence.findUnique.mockResolvedValue({
      transactionId: envelope.transactionId,
    });
    mockPrisma.ledgerEntry.findMany.mockResolvedValue([
      {
        userId: senderId,
        type: 'DEBIT',
        amountKobo: BigInt(envelope.amountKobo),
        envelopeJson: envelope,
      },
      {
        userId: recipientId,
        type: 'CREDIT',
        amountKobo: BigInt(envelope.amountKobo),
        envelopeJson: envelope,
      },
    ]);

    const res1 = await service.reconcile(recipientId, [envelope]);
    const res2 = await service.reconcile(recipientId, [envelope]);

    expect(res1[0]?.status).toBe('success');
    expect(res2[0]?.status).toBe('success'); // Idempotent
  });

  it('16. Sequence replay: same sequence number, different txId', async () => {
    const draft1 = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const env1 = signEnvelope(draft1, senderKey.privateKey);

    const draft2 = { 
      ...draft1, 
      amountKobo: toKobo(2000),
      senderBalanceAfterKobo: toKobo(draft1.senderBalanceBeforeKobo - 2000)
    }; // same sequence, different amount
    const env2 = signEnvelope(draft2, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    
    mockPrisma.processedSequence.create
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(
        new Prisma.PrismaClientKnownRequestError('Duplicate', {
          code: 'P2002',
          clientVersion: '5.x',
          meta: { target: ['userId', 'sequenceNumber'] },
        }),
      );
    mockPrisma.processedSequence.findUnique.mockResolvedValue({
      transactionId: env1.transactionId,
    });

    const res1 = await service.reconcile(recipientId, [env1]);
    const res2 = await service.reconcileOneInternal(recipientId, env2);

    expect(res1[0]?.status).toBe('success');
    expect(res2).toMatchObject({ status: 'rejected', reason: 'sequence_collision' });
    // First reconcile writes sender+recipient updates once; replay collision must not add more credits.
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
  });

  it('17. Out-of-order sequence: 10 before 9', async () => {
    const draft10 = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft10.senderSequenceNumber = 10;
    const env10 = signEnvelope(draft10, senderKey.privateKey);

    const draft9 = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft9.senderSequenceNumber = 9;
    const env9 = signEnvelope(draft9, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const results = await service.reconcile(recipientId, [env10, env9]);

    expect(results[0]?.status).toBe('success');
    expect(results[1]?.status).toBe('success');
  });

  it('18. Batch: independent processing', async () => {
    const draft1 = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const env1 = signEnvelope(draft1, senderKey.privateKey);

    const env2 = { ...env1, signature: 'invalid' }; // Bad one

    const draft3 = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    draft3.senderSequenceNumber = 2;
    const env3 = signEnvelope(draft3, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
        const where = args?.where;
        if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
        if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
        return Promise.resolve(null);
    });

    const results = await service.reconcile(recipientId, [env1, env2, env3]);

    expect(results).toHaveLength(3);
    expect(results[0]?.status).toBe('success');
    expect(results[1]?.status).toBe('rejected');
    expect(results[2]?.status).toBe('success');
  });

  it('19. Identity binding: valid signature but wrong recipientId field', async () => {
    const draft = createValidEnvelopeDraft(senderId, 'u_aaaaaaaaaaaaaaaa', senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    // Recipient B tries to submit it
    const result = await service.reconcileOneInternal('u_bbbbbbbbbbbbbbbb', envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'identity_mismatch' });
  });

  it('Internal error propagates as rejected with internal_error', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });
    mockPrisma.processedSequence.create.mockRejectedValue(new Error('DB crash'));

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'internal_error' });
  });

  it('fails closed for ambiguous P2002 target (no idempotent success)', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    // No target metadata -> ambiguous uniqueness source.
    mockPrisma.processedSequence.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Duplicate', {
        code: 'P2002',
        clientVersion: '5.x',
      }),
    );

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'internal_error' });
  });

  it('rejects S2S transfer when recipient is not a merchant', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      // Recipient is a STUDENT, not a MERCHANT
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy', 1000, 'STUDENT'));
      return Promise.resolve(null);
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'recipient_not_merchant' });
  });

  it('returns generic invalid_envelope reason to client regardless of actual failure', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);
    // Tamper with signature
    (envelope as any).signature = 'ed25519:' + 'f'.repeat(128);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const results = await service.reconcile(recipientId, [envelope]);
    expect(results[0]).toEqual({
      transactionId: envelope.transactionId,
      status: 'rejected',
      reason: 'invalid_envelope',
    });
  });

  it('detects balance change during transaction (Fix 1)', async () => {
    const amount = 1000;
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString, amount);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    let findUniqueCallCount = 0;
    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) {
        findUniqueCallCount++;
        // First call (outside tx): full balance
        // Second call (inside tx): reduced balance
        const balance = findUniqueCallCount === 1 ? 2000 : 500;
        return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString, balance));
      }
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'insufficient_balance' });
  });

  it('rejected envelope log payload does not include signature, publicKey, or sequenceNumber', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString, 1000);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString, 0)); // balance 0
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    const warnSpy = jest.spyOn(service['logger'], 'warn').mockImplementation();

    await service.reconcileOneInternal(recipientId, envelope);

    expect(warnSpy).toHaveBeenCalled();
    const logArg = warnSpy.mock.calls[0]![0];

    expect(logArg).toMatchObject({
      transactionId: envelope.transactionId,
      senderUserId: senderId,
      recipientUserId: recipientId,
      reason: 'insufficient_balance',
      amountKobo: envelope.amountKobo,
    });

    expect(logArg).not.toHaveProperty('signature');
    expect(logArg).not.toHaveProperty('senderPublicKey');
    expect(logArg).not.toHaveProperty('senderSequenceNumber');
    expect(logArg).not.toHaveProperty('requestNonce');
    expect(logArg).not.toHaveProperty('timestamp');
    expect(logArg).not.toHaveProperty('expiresAt');
    expect(logArg).not.toHaveProperty('senderBalanceBeforeKobo');
    expect(logArg).not.toHaveProperty('senderBalanceAfterKobo');

    warnSpy.mockRestore();
  });

  it('rejects envelope if recipient balance would exceed cap', async () => {
    const amount = 5000;
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString, amount);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) {
        // Recipient is already at cap minus 1000 kobo
        return Promise.resolve(createTestUser(recipientId, 'dummy', MAX_USER_BALANCE_KOBO - 1000));
      }
      return Promise.resolve(null);
    });

    mockPrisma.processedSequence.create.mockResolvedValue({});
    mockPrisma.ledgerEntry.create.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toMatchObject({ status: 'rejected', reason: 'recipient_balance_cap_exceeded' });
  });

  it('succeeds if recipient balance reaches exactly the cap', async () => {
    const amount = 5000;
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString, amount);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) {
        // Recipient will be exactly at cap after 5000 credit
        return Promise.resolve(createTestUser(recipientId, 'dummy', MAX_USER_BALANCE_KOBO - 5000));
      }
      return Promise.resolve(null);
    });

    mockPrisma.processedSequence.create.mockResolvedValue({});
    mockPrisma.ledgerEntry.create.mockResolvedValue({});
    mockPrisma.user.update.mockResolvedValue({});

    const result = await service.reconcileOneInternal(recipientId, envelope);
    expect(result).toEqual({ transactionId: envelope.transactionId, status: 'success' });
  });

  it('20. Retries on P2034 serialization anomaly and succeeds if subsequent attempt works', async () => {
    const draft = createValidEnvelopeDraft(senderId, recipientId, senderKey.publicKeyString);
    const envelope = signEnvelope(draft, senderKey.privateKey);

    mockPrisma.user.findUnique.mockImplementation((args: any) => {
      const where = args?.where;
      if (where?.id === senderId) return Promise.resolve(createTestUser(senderId, senderKey.publicKeyString));
      if (where?.id === recipientId) return Promise.resolve(createTestUser(recipientId, 'dummy'));
      return Promise.resolve(null);
    });

    let attempt = 0;
    // Temporarily override $transaction to throw P2034 twice, then succeed
    mockPrisma.$transaction.mockImplementation(async (callback: any) => {
      attempt++;
      if (attempt < 3) {
        throw new Prisma.PrismaClientKnownRequestError('Serialization anomaly', {
          code: 'P2034',
          clientVersion: '5.x',
        });
      }
      return callback(mockPrisma); // success on 3rd attempt
    });

    const result = await service.reconcileOneInternal(recipientId, envelope);

    expect(result).toEqual({ transactionId: envelope.transactionId, status: 'success' });
    expect(attempt).toBe(3);

    // Restore the original mock implementation
    mockPrisma.$transaction.mockImplementation((callback: any) => callback(mockPrisma));
  });
});
