import {
  Logger,
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { DeviceKeyStatus } from '@prisma/client';
import { createHash } from 'crypto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterKeySchema } from './schemas';
import * as ed from '@noble/ed25519';
import { fromHex, publicKeyFromString, toPublicKeyString, buildKeyRotationMessage } from '@oneto/shared';

// Shape of the request after JwtAuthGuard has attached the verified payload.
// Defined locally to avoid widening the Express Request type globally.
interface AuthenticatedRequest {
  user?: { sub?: string };
}

const VERIFY_ONLY_WINDOW_MS = 24 * 60 * 60 * 1000;

@Controller('auth/keys')
export class KeysController {
  private readonly logger = new Logger(KeysController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard)
  async register(@Req() req: AuthenticatedRequest, @Body() body: unknown) {
    const userId = req.user?.sub;
    if (!userId) {
      throw new UnauthorizedException('User ID not found in token');
    }

    const result = RegisterKeySchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException(result.error.errors[0]?.message || 'Invalid public key format');
    }

    const { publicKey: newPublicKey, rotationSignature } = result.data;

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const activeDeviceKey = await this.prisma.userDeviceKey.findFirst({
      where: {
        userId,
        status: DeviceKeyStatus.ACTIVE,
      },
      orderBy: { validFrom: 'desc' },
    });

    if (!activeDeviceKey) {
      await this.createActiveDeviceKey(userId, newPublicKey);
      return { success: true };
    }

    if (activeDeviceKey.publicKey === newPublicKey) {
      return { success: true };
    }

    if (!rotationSignature) {
      throw new BadRequestException('rotation_signature_required');
    }

    const existingKeyWithSamePublicKey = await this.prisma.userDeviceKey.findUnique({
      where: {
        userId_publicKey: {
          userId,
          publicKey: newPublicKey,
        },
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (existingKeyWithSamePublicKey) {
      if (existingKeyWithSamePublicKey.status === DeviceKeyStatus.REVOKED) {
        throw new BadRequestException('public_key_revoked');
      }
      throw new BadRequestException('public_key_already_registered');
    }

    const oldPubBytes = publicKeyFromString(toPublicKeyString(activeDeviceKey.publicKey));
    const sigHex = rotationSignature.slice('ed25519:'.length);
    const sigBytes = fromHex(sigHex);
    const message = buildKeyRotationMessage(newPublicKey);
    const messageBytes = new TextEncoder().encode(message);
    const messageHashSuffix = createHash('sha256')
      .update(messageBytes)
      .digest('hex')
      .slice(-8);

    this.logger.log(
      JSON.stringify({
        event: 'key_rotation_verify_attempt',
        ...buildSafeKeyRegisterDiagnostics({
          userId,
          userEmail: user.email,
          activeDeviceKey: activeDeviceKey.publicKey,
          newPublicKey,
          hasRotationSignature: Boolean(rotationSignature),
          sigOk: null,
          messageHashSuffix,
          signatureLength: sigBytes.length,
        }),
      }),
    );

    let sigOk = false;
    try {
      sigOk = await ed.verify(sigBytes, messageBytes, oldPubBytes);
    } catch {
      sigOk = false;
    }

    this.logger.log(
      JSON.stringify({
        event: 'key_rotation_verify_result',
        ...buildSafeKeyRegisterDiagnostics({
          userId,
          userEmail: user.email,
          activeDeviceKey: activeDeviceKey.publicKey,
          newPublicKey,
          hasRotationSignature: Boolean(rotationSignature),
          sigOk,
          messageHashSuffix,
          signatureLength: sigBytes.length,
        }),
      }),
    );

    if (!sigOk) {
      throw new UnauthorizedException('rotation_signature_invalid');
    }

    const retiredAt = new Date();
    // Keep old keys verify-only for a short finite window so already-scanned
    // envelopes can still settle without leaving old signing authority active.
    const verifyUntil = new Date(retiredAt.getTime() + VERIFY_ONLY_WINDOW_MS);

    await this.prisma.$transaction(async (tx) => {
      await tx.userDeviceKey.update({
        where: { id: activeDeviceKey.id },
        data: {
          status: DeviceKeyStatus.VERIFY_ONLY,
          retiredAt,
          verifyUntil,
        },
      });

      await tx.userDeviceKey.create({
        data: {
          userId,
          publicKey: newPublicKey,
          status: DeviceKeyStatus.ACTIVE,
          validFrom: retiredAt,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { publicKey: newPublicKey },
      });
    });

    return { success: true };
  }

  private async createActiveDeviceKey(userId: string, publicKey: string): Promise<void> {
    const existingDeviceKey = await this.prisma.userDeviceKey.findUnique({
      where: {
        userId_publicKey: {
          userId,
          publicKey,
        },
      },
      select: {
        status: true,
      },
    });

    if (existingDeviceKey) {
      if (existingDeviceKey.status === DeviceKeyStatus.REVOKED) {
        throw new BadRequestException('public_key_revoked');
      }
      throw new BadRequestException('public_key_already_registered');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userDeviceKey.create({
        data: {
          userId,
          publicKey,
          status: DeviceKeyStatus.ACTIVE,
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { publicKey },
      });
    });
  }
}

export interface KeyRegisterDiagnosticsInput {
  readonly userId: string;
  readonly userEmail: string;
  readonly activeDeviceKey: string;
  readonly newPublicKey: string;
  readonly hasRotationSignature: boolean;
  readonly sigOk: boolean | null;
  readonly messageHashSuffix: string;
  readonly signatureLength: number;
}

export interface SafeKeyRegisterDiagnostics {
  readonly userId: string;
  readonly userEmail: string;
  readonly activeDeviceKeySuffix: string;
  readonly newPublicKeySuffix: string;
  readonly hasRotationSignature: boolean;
  readonly sigOk: boolean | null;
  readonly messageHashSuffix: string;
  readonly signatureLength: number;
}

export function buildSafeKeyRegisterDiagnostics(
  input: KeyRegisterDiagnosticsInput,
): SafeKeyRegisterDiagnostics {
  return {
    userId: input.userId,
    userEmail: input.userEmail,
    activeDeviceKeySuffix: shortKeySuffix(input.activeDeviceKey),
    newPublicKeySuffix: shortKeySuffix(input.newPublicKey),
    hasRotationSignature: input.hasRotationSignature,
    sigOk: input.sigOk,
    messageHashSuffix: input.messageHashSuffix,
    signatureLength: input.signatureLength,
  };
}

function shortKeySuffix(value: string): string {
  if (value.length <= 8) {
    return value;
  }
  return value.slice(-8);
}
