import { Injectable, Logger, UnauthorizedException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KorapayService } from './korapay.service';
import { Prisma, LedgerEntryType } from '@prisma/client';
import { MAX_USER_BALANCE_KOBO } from '@oneto/shared';
import * as crypto from 'crypto';
import { KorapayWebhookSchema } from './korapay-webhook.schema';

@Injectable()
export class TopupService {
  private readonly logger = new Logger(TopupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly korapayService: KorapayService,
  ) { }

  async initiate(userId: string, amountKobo: number): Promise<{ reference: string, paymentUrl: string }> {
    if (amountKobo < 10000 || amountKobo > 100000000) {
      throw new BadRequestException('Amount must be between 100 NGN and 1,000,000 NGN');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    const reference = 'top_' + crypto.randomBytes(12).toString('hex');


    // Store reference→userId mapping so the webhook can identify the user
    // even when Korapay's payload omits the customer email (sandbox behavior).
    await this.prisma.paymentTopup.create({
      data: {
        reference,
        userId,
        amountKobo: BigInt(amountKobo),
        status: 'PENDING',
        korapayResponse: {} as Prisma.InputJsonValue,
      },
    });

    const result = await this.korapayService.initiateCheckout({
      amountKobo,
      reference,
      customerEmail: user.email,
    });

    return {
      reference,
      paymentUrl: result.paymentUrl,
    };
  }

  async handleWebhook(payload: unknown, signatureHeader: string | undefined): Promise<{ success: true }> {
    // 1. Verify signature on RAW payload.data
    const rawData = (payload as any)?.data;
    if (!payload || !this.korapayService.verifyWebhookSignature(rawData, signatureHeader)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    // 2. Schema validate
    const parseResult = KorapayWebhookSchema.safeParse(payload);
    if (!parseResult.success) {
      this.logger.warn({ issues: parseResult.error.issues }, 'Webhook payload failed schema validation');
      throw new BadRequestException('Invalid webhook payload structure');
    }
    const validated = parseResult.data;

    const { event, data } = validated;

    // Fix 3: Webhook event spoofing protection
    const eventStatusMap: Record<string, string> = {
      'charge.success': 'success',
      'charge.failed': 'failed',
    };
    const expectedDataStatus = eventStatusMap[event];
    if (expectedDataStatus && data.status !== expectedDataStatus) {
      this.logger.warn({ event, dataStatus: data.status }, 'Webhook event/status mismatch');
      return { success: true }; // return 200 to stop Korapay retries, but don't process
    }

    if (event !== 'charge.success' && event !== 'charge.failed') {
      this.logger.log(`Ignoring unhandled event type: ${event}`);
      return { success: true };
    }

    const reference = data.reference;
    const customerEmail = data.customer?.email;

    const amountNgn = Number(data.amount);
    if (isNaN(amountNgn) || !isFinite(amountNgn) || amountNgn <= 0) {
      this.logger.error(`Invalid amount in webhook payload: ${data.amount}`);
      throw new BadRequestException('Invalid amount in webhook payload');
    }

    const amountKobo = Math.round(amountNgn * 100);

    // Primary: look up user via the PENDING PaymentTopup created during initiation.
    // Fallback: customer email from webhook payload (may be missing in sandbox).
    const pendingTopup = await this.prisma.paymentTopup.findUnique({
      where: { reference },
      select: { userId: true, status: true },
    });
    if (pendingTopup && pendingTopup.status !== 'PENDING') {
      this.logger.log(`Idempotent webhook: reference ${reference} already ${pendingTopup.status}`);
      return { success: true };
    }
    const resolvedUserId = pendingTopup?.userId ?? null;
    const user = resolvedUserId
      ? await this.prisma.user.findUnique({ where: { id: resolvedUserId } })
      : customerEmail
        ? await this.prisma.user.findUnique({ where: { email: customerEmail } })
        : null;

    if (event === 'charge.failed') {
      try {
        await this.prisma.paymentTopup.upsert({
          where: { reference },
          update: {
            status: 'FAILED',
            korapayResponse: validated as unknown as Prisma.InputJsonValue,
          },
          create: {
            reference,
            userId: resolvedUserId || user?.id || 'UNKNOWN',
            amountKobo: BigInt(amountKobo),
            status: 'FAILED',
            korapayResponse: validated as unknown as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return { success: true }; // Idempotent success
        }
        this.logger.error(`Failed to record failed payment topup: ${err}`);
      }
      return { success: true };
    }


    if (!user) {
      this.logger.warn(`Webhook received for unknown user email: ${customerEmail}`);
      return { success: true };
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.paymentTopup.upsert({
            where: { reference },
            update: {
              status: 'SUCCESS',
              korapayResponse: validated as unknown as Prisma.InputJsonValue,
            },
            create: {
              reference,
              userId: user.id,
              amountKobo: BigInt(amountKobo),
              status: 'SUCCESS',
              korapayResponse: validated as unknown as Prisma.InputJsonValue,
            },
          });

          const freshUser = await tx.user.findUnique({
            where: { id: user.id },
            select: { verifiedBalanceKobo: true },
          });

          if (!freshUser) {
            throw new Error('User missing during transaction');
          }

          if (freshUser.verifiedBalanceKobo + BigInt(amountKobo) > BigInt(MAX_USER_BALANCE_KOBO)) {
            this.logger.warn(
              {
                reference,
                userId: user.id,
                attemptedAmountKobo: amountKobo,
                currentBalanceKobo: freshUser.verifiedBalanceKobo.toString(),
              },
              'Top-up failed: balance cap exceeded',
            );
            // We already created the PaymentTopup record above with status SUCCESS.
            // We need to update it to FAILED because we are not going to credit the user.
            // Alternatively, we could have created it with FAILED if we knew.
            // Let's change the flow to create it AFTER the check, or update it.
            // Actually, the constraint says "The transaction commits (the FAILED PaymentTopup is the only effect)".
            // So I should create it with FAILED status here and return.
            await tx.paymentTopup.update({
              where: { reference },
              data: {
                status: 'FAILED',
                korapayResponse: { ...validated, internal_failure: 'balance_cap_exceeded' } as unknown as Prisma.InputJsonValue,
              },
            });
            return;
          }

          const operatingAccount = await tx.user.findUnique({
            where: { id: 'u_operating' },
          });

          if (!operatingAccount) {
            throw new Error('Operating account missing');
          }

          const updatedUser = await tx.user.update({
            where: { id: user.id },
            data: {
              verifiedBalanceKobo: {
                increment: BigInt(amountKobo),
              },
            },
          });

          const updatedOperating = await tx.user.update({
            where: { id: 'u_operating' },
            data: {
              verifiedBalanceKobo: {
                decrement: BigInt(amountKobo),
              },
            },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: reference,
              userId: user.id,
              type: LedgerEntryType.CREDIT,
              amountKobo: BigInt(amountKobo),
              balanceAfterKobo: updatedUser.verifiedBalanceKobo,
              description: `Top-up via Korapay ${reference}`,
            },
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: reference,
              userId: 'u_operating',
              type: LedgerEntryType.DEBIT,
              amountKobo: BigInt(amountKobo),
              balanceAfterKobo: updatedOperating.verifiedBalanceKobo,
              description: `Top-up credit to user ${user.id} ${reference}`,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        this.logger.log(`Idempotent webhook delivery for reference: ${reference}`);
        return { success: true };
      }
      this.logger.error(`Transaction failed for webhook reference ${reference}: ${err}`);
      throw new InternalServerErrorException('Webhook processing failed');
    }

    return { success: true };
  }
}
