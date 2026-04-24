import { Test, TestingModule } from '@nestjs/testing';
import { KeysController } from './keys.controller';
import { PrismaService } from '../prisma/prisma.service';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { ExecutionContext } from '@nestjs/common';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';
import { generateKeypair } from '@oneto/shared';

// @noble/ed25519 v2 requires this shim so it can compute SHA-512
// synchronously where needed. One-time setup for tests.
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

describe('KeysController', () => {
  let controller: KeysController;
  let prisma: PrismaService;

  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockJwtGuard = {
    canActivate: (context: ExecutionContext) => {
      const req = context.switchToHttp().getRequest();
      req.user = { sub: 'u_0123456789abcdef' };
      return true;
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KeysController],
      providers: [
        { provide: PrismaService, useValue: mockPrisma },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile();

    controller = module.get<KeysController>(KeysController);
    prisma = module.get<PrismaService>(PrismaService);

    jest.clearAllMocks();
  });

  const userId = 'u_0123456789abcdef';
  const req = { user: { sub: userId } };

  it('1. First registration, no rotation signature -> success', async () => {
    const keypair = generateKeypair();
    const publicKey = keypair.publicKeyString;

    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, publicKey: null });
    mockPrisma.user.update.mockResolvedValue({ id: userId, publicKey });

    const result = await controller.register(req, { publicKey });

    expect(result).toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { publicKey },
    });
  });

  it('2. First registration, with rotation signature (should be ignored) -> success', async () => {
    const keypair = generateKeypair();
    const publicKey = keypair.publicKeyString;
    const dummySignature = 'ed25519:' + '0'.repeat(128);

    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, publicKey: null });
    mockPrisma.user.update.mockResolvedValue({ id: userId, publicKey });

    const result = await controller.register(req, { publicKey, rotationSignature: dummySignature });

    expect(result).toEqual({ success: true });
  });

  it('3. Second registration, no rotation signature -> rejected rotation_signature_required', async () => {
    const oldKey = generateKeypair().publicKeyString;
    const newKey = generateKeypair().publicKeyString;

    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, publicKey: oldKey });

    await expect(controller.register(req, { publicKey: newKey }))
      .rejects.toThrow('rotation_signature_required');
  });

  it('4. Second registration, invalid rotation signature (signed by different key) -> rejected rotation_signature_invalid', async () => {
    const oldKeypair = generateKeypair();
    const wrongKeypair = generateKeypair();
    const newKey = generateKeypair().publicKeyString;

    // Sign with wrong key
    const messageBytes = new TextEncoder().encode(newKey);
    const sigBytes = await ed.sign(messageBytes, wrongKeypair.privateKey);
    const rotationSignature = `ed25519:${Buffer.from(sigBytes).toString('hex')}`;

    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, publicKey: oldKeypair.publicKeyString });

    await expect(controller.register(req, { publicKey: newKey, rotationSignature }))
      .rejects.toThrow('rotation_signature_invalid');
  });

  it('5. Second registration, valid rotation signature -> success, publicKey updated', async () => {
    const oldKeypair = generateKeypair();
    const newKey = generateKeypair().publicKeyString;

    // Sign with old key
    const messageBytes = new TextEncoder().encode(newKey);
    const sigBytes = await ed.sign(messageBytes, oldKeypair.privateKey);
    const rotationSignature = `ed25519:${Buffer.from(sigBytes).toString('hex')}`;

    mockPrisma.user.findUnique.mockResolvedValue({ id: userId, publicKey: oldKeypair.publicKeyString });
    mockPrisma.user.update.mockResolvedValue({ id: userId, publicKey: newKey });

    const result = await controller.register(req, { publicKey: newKey, rotationSignature });

    expect(result).toEqual({ success: true });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: userId },
      data: { publicKey: newKey },
    });
  });

  it('should fail if user not found', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(controller.register(req, { publicKey: 'ed25519:' + '0'.repeat(64) }))
      .rejects.toThrow(UnauthorizedException);
  });
});
