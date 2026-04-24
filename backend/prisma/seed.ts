import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding operating account...');
  
  // The operating account — represents oneto's pooled Korapay balance.
  // Every top-up credits this user (money came in from Korapay).
  // Every cashout debits this user (money going out via Korapay).
  // Invariant: SUM(user balances) + u_operating.verifiedBalanceKobo === 0

  await prisma.user.upsert({
    where: { id: 'u_operating' },
    update: {},
    create: {
      id: 'u_operating',
      email: 'operating@getoneto.internal',
      role: 'ADMIN',
      status: 'ACTIVE',
      verifiedBalanceKobo: 0n,
      sequenceNumber: 0,
    },
  });

  console.log('Seed completed successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
