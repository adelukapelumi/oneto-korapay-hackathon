import {
  Controller,
  Post,
  Body,
  UseGuards,
  Req,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterKeySchema } from './schemas';
import * as ed from '@noble/ed25519';
import { fromHex, publicKeyFromString, toPublicKeyString } from '@oneto/shared';

// Shape of the request after JwtAuthGuard has attached the verified payload.
// Defined locally to avoid widening the Express Request type globally.
interface AuthenticatedRequest {
  user?: { sub?: string };
}

@Controller('auth/keys')
export class KeysController {
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
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // If user already has a key, require a signed rotation
    if (user.publicKey) {
      if (!rotationSignature) {
        throw new BadRequestException('rotation_signature_required');
      }

      // user.publicKey was previously written by this same endpoint, so it
      // already matches the regex enforced by RegisterKeySchema. The branded
      // assertion via toPublicKeyString cannot fail at runtime here and lets
      // us avoid a raw `any` cast on a security-critical branded type.
      const oldPubBytes = publicKeyFromString(toPublicKeyString(user.publicKey));
      const sigHex = rotationSignature.slice('ed25519:'.length);
      const sigBytes = fromHex(sigHex);
      const messageBytes = new TextEncoder().encode(newPublicKey);

      let sigOk = false;
      try {
        sigOk = await ed.verify(sigBytes, messageBytes, oldPubBytes);
      } catch {
        sigOk = false;
      }

      if (!sigOk) {
        throw new UnauthorizedException('rotation_signature_invalid');
      }
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { publicKey: newPublicKey },
    });

    return { success: true };
  }
}
