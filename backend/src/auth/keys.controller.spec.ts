import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { DeviceKeyStatus } from '@prisma/client';
import { sha512 } from '@noble/hashes/sha512';
import * as ed from '@noble/ed25519';
import { buildKeyRotationMessage, generateKeypair } from '@oneto/shared';
import { KeysController } from './keys.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

ed.etc.sha512Sync = (...messages) => sha512(ed.etc.concatBytes(...messages));

interface MockUserRecord {
  id: string;
  publicKey: string | null;
}

interface MockUserDeviceKeyRecord {
  id: string;
  userId: string;
  publicKey: string;
  status: DeviceKeyStatus;
  validFrom: Date;
  retiredAt: Date | null;
  verifyUntil: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

type PrismaMock = {
  $transaction: jest.Mock;
  user: {
    findUnique: jest.Mock;
    update: jest.Mock;
  };
  userDeviceKey: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
};

describe('KeysController', () => {
  let controller: KeysController;
  let currentUser: MockUserRecord | null;
  let deviceKeys: MockUserDeviceKeyRecord[];
  let nextDeviceKeyId: number;
  let mockPrisma: PrismaMock;

  const userId = 'u_0123456789abcdef';
  const req = { user: { sub: userId } };

  const mockJwtGuard = {
    canActivate: (context: ExecutionContext) => {
      const httpRequest = context.switchToHttp().getRequest();
      httpRequest.user = { sub: userId };
      return true;
    },
  };

  const listActiveKeys = (): MockUserDeviceKeyRecord[] =>
    deviceKeys.filter((deviceKey) => deviceKey.status === DeviceKeyStatus.ACTIVE);

  const addExistingDeviceKey = (
    publicKey: string,
    status: DeviceKeyStatus = DeviceKeyStatus.ACTIVE,
  ): MockUserDeviceKeyRecord => {
    const now = new Date();
    const existingDeviceKey: MockUserDeviceKeyRecord = {
      id: `dk_${nextDeviceKeyId++}`,
      userId,
      publicKey,
      status,
      validFrom: now,
      retiredAt: null,
      verifyUntil: null,
      createdAt: now,
      updatedAt: now,
    };

    deviceKeys.push(existingDeviceKey);
    return existingDeviceKey;
  };

  beforeEach(async () => {
    jest.useRealTimers();

    currentUser = { id: userId, publicKey: null };
    deviceKeys = [];
    nextDeviceKeyId = 1;

    mockPrisma = {
      $transaction: jest.fn(async (callback: (tx: PrismaMock) => Promise<unknown>) => callback(mockPrisma)),
      user: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
          if (!currentUser || currentUser.id !== where.id) {
            return null;
          }

          return { ...currentUser };
        }),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: { publicKey?: string | null } }) => {
          if (!currentUser || currentUser.id !== where.id) {
            throw new Error('User not found');
          }

          currentUser = {
            ...currentUser,
            publicKey: data.publicKey ?? currentUser.publicKey,
          };

          return { ...currentUser };
        }),
      },
      userDeviceKey: {
        findFirst: jest.fn(
          async ({
            where,
          }: {
            where: { userId: string; status: DeviceKeyStatus };
          }) => {
            const deviceKey = deviceKeys.find(
              (candidate) =>
                candidate.userId === where.userId &&
                candidate.status === where.status,
            );

            return deviceKey ? { ...deviceKey } : null;
          },
        ),
        findUnique: jest.fn(
          async ({
            where,
          }: {
            where: { userId_publicKey: { userId: string; publicKey: string } };
          }) => {
            const deviceKey = deviceKeys.find(
              (candidate) =>
                candidate.userId === where.userId_publicKey.userId &&
                candidate.publicKey === where.userId_publicKey.publicKey,
            );

            return deviceKey ? { ...deviceKey } : null;
          },
        ),
        create: jest.fn(
          async ({
            data,
          }: {
            data: {
              userId: string;
              publicKey: string;
              status: DeviceKeyStatus;
              validFrom?: Date;
            };
          }) => {
            const now = data.validFrom ?? new Date();
            const createdDeviceKey: MockUserDeviceKeyRecord = {
              id: `dk_${nextDeviceKeyId++}`,
              userId: data.userId,
              publicKey: data.publicKey,
              status: data.status,
              validFrom: data.validFrom ?? now,
              retiredAt: null,
              verifyUntil: null,
              createdAt: now,
              updatedAt: now,
            };

            deviceKeys.push(createdDeviceKey);
            return { ...createdDeviceKey };
          },
        ),
        update: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string };
            data: {
              status?: DeviceKeyStatus;
              retiredAt?: Date | null;
              verifyUntil?: Date | null;
            };
          }) => {
            const deviceKeyIndex = deviceKeys.findIndex(
              (candidate) => candidate.id === where.id,
            );
            if (deviceKeyIndex === -1) {
              throw new Error('Device key not found');
            }

            const updatedDeviceKey: MockUserDeviceKeyRecord = {
              ...deviceKeys[deviceKeyIndex]!,
              status: data.status ?? deviceKeys[deviceKeyIndex]!.status,
              retiredAt:
                data.retiredAt !== undefined
                  ? data.retiredAt
                  : deviceKeys[deviceKeyIndex]!.retiredAt,
              verifyUntil:
                data.verifyUntil !== undefined
                  ? data.verifyUntil
                  : deviceKeys[deviceKeyIndex]!.verifyUntil,
              updatedAt: new Date(),
            };

            deviceKeys[deviceKeyIndex] = updatedDeviceKey;
            return { ...updatedDeviceKey };
          },
        ),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [KeysController],
      providers: [{ provide: PrismaService, useValue: mockPrisma }],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue(mockJwtGuard)
      .compile();

    controller = module.get<KeysController>(KeysController);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('creates an ACTIVE UserDeviceKey and updates the User.publicKey mirror on first registration', async () => {
    const publicKey = generateKeypair().publicKeyString;

    const result = await controller.register(req, { publicKey });

    expect(result).toEqual({ success: true });
    expect(currentUser?.publicKey).toBe(publicKey);
    expect(deviceKeys).toHaveLength(1);
    expect(deviceKeys[0]).toMatchObject({
      userId,
      publicKey,
      status: DeviceKeyStatus.ACTIVE,
      retiredAt: null,
      verifyUntil: null,
    });
    expect(listActiveKeys()).toHaveLength(1);
  });

  it('treats same-publicKey registration as idempotent when the ACTIVE key already matches', async () => {
    const publicKey = generateKeypair().publicKeyString;
    currentUser = { id: userId, publicKey };
    addExistingDeviceKey(publicKey, DeviceKeyStatus.ACTIVE);

    const result = await controller.register(req, { publicKey });

    expect(result).toEqual({ success: true });
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
    expect(mockPrisma.userDeviceKey.create).not.toHaveBeenCalled();
    expect(mockPrisma.userDeviceKey.update).not.toHaveBeenCalled();
    expect(listActiveKeys()).toHaveLength(1);
  });

  it('rejects registration of a different key without rotationSignature when an ACTIVE key already exists', async () => {
    const oldPublicKey = generateKeypair().publicKeyString;
    const newPublicKey = generateKeypair().publicKeyString;

    currentUser = { id: userId, publicKey: oldPublicKey };
    addExistingDeviceKey(oldPublicKey, DeviceKeyStatus.ACTIVE);

    await expect(controller.register(req, { publicKey: newPublicKey })).rejects.toThrow(
      new BadRequestException('rotation_signature_required'),
    );
  });

  it('rejects an invalid rotationSignature', async () => {
    const oldKeypair = generateKeypair();
    const wrongKeypair = generateKeypair();
    const newPublicKey = generateKeypair().publicKeyString;

    currentUser = { id: userId, publicKey: oldKeypair.publicKeyString };
    addExistingDeviceKey(oldKeypair.publicKeyString, DeviceKeyStatus.ACTIVE);

    const messageBytes = new TextEncoder().encode(buildKeyRotationMessage(newPublicKey));
    const invalidSignatureBytes = await ed.sign(messageBytes, wrongKeypair.privateKey);
    const rotationSignature = `ed25519:${Buffer.from(invalidSignatureBytes).toString('hex')}`;

    await expect(
      controller.register(req, { publicKey: newPublicKey, rotationSignature }),
    ).rejects.toThrow(new UnauthorizedException('rotation_signature_invalid'));
  });

  it('rotates a valid ACTIVE key to VERIFY_ONLY and creates a new ACTIVE key', async () => {
    const fixedNow = new Date('2026-05-21T02:45:00.000Z');
    jest.useFakeTimers().setSystemTime(fixedNow);

    const oldKeypair = generateKeypair();
    const newPublicKey = generateKeypair().publicKeyString;

    currentUser = { id: userId, publicKey: oldKeypair.publicKeyString };
    const oldDeviceKey = addExistingDeviceKey(oldKeypair.publicKeyString, DeviceKeyStatus.ACTIVE);

    const messageBytes = new TextEncoder().encode(buildKeyRotationMessage(newPublicKey));
    const validSignatureBytes = await ed.sign(messageBytes, oldKeypair.privateKey);
    const rotationSignature = `ed25519:${Buffer.from(validSignatureBytes).toString('hex')}`;

    const result = await controller.register(req, { publicKey: newPublicKey, rotationSignature });

    expect(result).toEqual({ success: true });
    expect(currentUser?.publicKey).toBe(newPublicKey);

    const rotatedOldKey = deviceKeys.find((deviceKey) => deviceKey.id === oldDeviceKey.id);
    const newActiveKey = deviceKeys.find(
      (deviceKey) =>
        deviceKey.publicKey === newPublicKey &&
        deviceKey.status === DeviceKeyStatus.ACTIVE,
    );

    expect(rotatedOldKey).toMatchObject({
      status: DeviceKeyStatus.VERIFY_ONLY,
      retiredAt: fixedNow,
    });
    expect(rotatedOldKey?.verifyUntil?.toISOString()).toBe('2026-05-22T02:45:00.000Z');
    expect(newActiveKey).toMatchObject({
      userId,
      publicKey: newPublicKey,
      status: DeviceKeyStatus.ACTIVE,
      validFrom: fixedNow,
    });
  });

  it('leaves exactly one ACTIVE key after a valid rotation', async () => {
    const oldKeypair = generateKeypair();
    const newPublicKey = generateKeypair().publicKeyString;

    currentUser = { id: userId, publicKey: oldKeypair.publicKeyString };
    addExistingDeviceKey(oldKeypair.publicKeyString, DeviceKeyStatus.ACTIVE);

    const messageBytes = new TextEncoder().encode(buildKeyRotationMessage(newPublicKey));
    const validSignatureBytes = await ed.sign(messageBytes, oldKeypair.privateKey);
    const rotationSignature = `ed25519:${Buffer.from(validSignatureBytes).toString('hex')}`;

    await controller.register(req, { publicKey: newPublicKey, rotationSignature });

    const activeKeys = listActiveKeys();
    expect(activeKeys).toHaveLength(1);
    expect(activeKeys[0]?.publicKey).toBe(newPublicKey);
  });

  it('rejects registration when the authenticated user no longer exists', async () => {
    currentUser = null;

    await expect(
      controller.register(req, { publicKey: generateKeypair().publicKeyString }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
