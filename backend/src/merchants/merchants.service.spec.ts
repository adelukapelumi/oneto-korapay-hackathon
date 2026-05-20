import { Test } from "@nestjs/testing";
import { MerchantsService } from "./merchants.service";
import { PrismaService } from "../prisma/prisma.service";

describe("MerchantsService", () => {
  let service: MerchantsService;
  let prisma: { user: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = {
      user: {
        findMany: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        MerchantsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(MerchantsService);
  });

  it("queries only ACTIVE approved merchants", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.listActiveApprovedMerchants();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
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
      }),
    );
  });

  it("returns id + businessName label list", async () => {
    prisma.user.findMany.mockResolvedValue([
      {
        id: "u_aaaaaaaaaaaaaaaa",
        merchantProfile: { businessName: "Campus Cafe" },
      },
      {
        id: "u_bbbbbbbbbbbbbbbb",
        merchantProfile: { businessName: "Bookshop" },
      },
    ]);

    const result = await service.listActiveApprovedMerchants();

    expect(result).toEqual([
      { id: "u_aaaaaaaaaaaaaaaa", label: "Campus Cafe" },
      { id: "u_bbbbbbbbbbbbbbbb", label: "Bookshop" },
    ]);
  });

  it("keeps deactivated merchants out of the student merchant list by requiring ACTIVE status", async () => {
    prisma.user.findMany.mockResolvedValue([]);

    await service.listActiveApprovedMerchants();

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
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
      }),
    );
  });
});
