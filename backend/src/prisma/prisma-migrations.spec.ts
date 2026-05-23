import { readFileSync } from 'fs';
import { join } from 'path';

describe('Prisma migrations', () => {
  const backendRoot = join(__dirname, '..', '..');

  it('PaymentTopup fee-accounting migration adds the current schema fields safely', () => {
    const schema = readFileSync(join(backendRoot, 'prisma', 'schema.prisma'), 'utf8');
    const migration = readFileSync(
      join(
        backendRoot,
        'prisma',
        'migrations',
        '20260523120000_add_topup_fee_accounting',
        'migration.sql',
      ),
      'utf8',
    );

    expect(schema).toContain('enum TopupFeeBearer');
    expect(schema).toContain('creditedAmountKobo BigInt');
    expect(schema).toContain('feeBearer          TopupFeeBearer @default(STUDENT)');
    expect(schema).toContain('processorFeeKobo   BigInt?');
    expect(schema).toContain('grossPaidKobo      BigInt?');

    expect(migration).toContain("CREATE TYPE \"TopupFeeBearer\" AS ENUM ('STUDENT', 'ONETO', 'UNKNOWN')");
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "creditedAmountKobo" BIGINT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "feeBearer" "TopupFeeBearer" NOT NULL DEFAULT \'STUDENT\'');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "processorFeeKobo" BIGINT');
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS "grossPaidKobo" BIGINT');
  });

  it('PaymentTopup migration backfills old rows before enforcing creditedAmountKobo NOT NULL', () => {
    const migration = readFileSync(
      join(
        backendRoot,
        'prisma',
        'migrations',
        '20260523120000_add_topup_fee_accounting',
        'migration.sql',
      ),
      'utf8',
    );

    const addNullableColumnIndex = migration.indexOf('ADD COLUMN IF NOT EXISTS "creditedAmountKobo" BIGINT');
    const backfillIndex = migration.indexOf('SET "creditedAmountKobo" = "amountKobo"');
    const notNullIndex = migration.indexOf('ALTER COLUMN "creditedAmountKobo" SET NOT NULL');

    expect(addNullableColumnIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(addNullableColumnIndex);
    expect(notNullIndex).toBeGreaterThan(backfillIndex);
  });
});
