import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface ActiveMerchantDto {
  id: string;
  label: string;
}

@Injectable()
export class MerchantsService {
  constructor(private readonly prisma: PrismaService) {}

  async listActiveApprovedMerchants(): Promise<ActiveMerchantDto[]> {
    const merchants = await this.prisma.user.findMany({
      where: {
        role: "MERCHANT",
        status: "ACTIVE",
        merchantProfile: {
          is: {
            verifiedAt: {
              not: null,
            },
          },
        },
      },
      select: {
        id: true,
        merchantProfile: {
          select: {
            businessName: true,
          },
        },
      },
      orderBy: {
        merchantProfile: {
          businessName: "asc",
        },
      },
    });

    const approved = merchants.filter(
      (
        m,
      ): m is {
        id: string;
        merchantProfile: { businessName: string };
      } => m.merchantProfile !== null,
    );

    return approved.map((m) => ({
      id: m.id,
      label: m.merchantProfile.businessName,
    }));
  }
}
