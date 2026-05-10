import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import { normalizeEmail, InvalidEmailError } from '../src/common/email';
import { normalizePhone, InvalidPhoneError } from '../src/common/phone';

const prisma = new PrismaClient();

interface MerchantInput {
  email: string;
  businessName: string;
  phone: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  businessAddress?: string;
}

interface NormalizedMerchant {
  email: string;
  businessName: string;
  phone: string;
  bankName: string;
  bankCode: string;
  accountNumber: string;
  accountName: string;
  businessAddress: string | undefined;
}

function generateUserId(): string {
  return `u_${randomBytes(8).toString('hex')}`;
}

function printUsage(): void {
  console.log([
    'Usage: ts-node scripts/register-merchant.ts [options]',
    '',
    'Single merchant:',
    '  --email            merchant email address (required)',
    '  --businessName     display name for the business (required)',
    '  --phone            Nigerian mobile number (required)',
    '  --bankName         bank name, e.g. "GTBank" (required)',
    '  --bankCode         3-digit bank code, e.g. "058" (required)',
    '  --accountNumber    10-digit NUBAN account number (required)',
    '  --accountName      name on the bank account (required)',
    '  --businessAddress  physical address (optional)',
    '',
    'Batch mode:',
    '  --file             path to a JSON file with an array of merchant objects',
    '',
    'Batch JSON format:',
    '  [',
    '    {',
    '      "email": "mama@gmail.com",',
    '      "businessName": "Mama\'s Buka",',
    '      "phone": "08012345678",',
    '      "bankName": "GTBank",',
    '      "bankCode": "058",',
    '      "accountNumber": "0123456789",',
    '      "accountName": "Mama Ngozi"',
    '    }',
    '  ]',
  ].join('\n'));
}

function parseArgs(args: string[]): {
  single: MerchantInput | null;
  batchFile: string | null;
  error: string | null;
} {
  const map = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    if (args[i]!.startsWith('--')) {
      const key = args[i]!;
      const value = args[i + 1] ?? '';
      if (!value.startsWith('--')) {
        map.set(key, value);
        i++;
      } else {
        map.set(key, '');
      }
    }
  }

  if (map.has('--help') || map.has('-h')) {
    printUsage();
    process.exit(0);
  }

  if (map.has('--file')) {
    const filePath = map.get('--file');
    if (!filePath) {
      return {
        single: null,
        batchFile: null,
        error: '--file requires a path argument',
      };
    }
    return { single: null, batchFile: filePath, error: null };
  }

  const email = map.get('--email');
  const businessName = map.get('--businessName');
  const phone = map.get('--phone');
  const bankName = map.get('--bankName');
  const bankCode = map.get('--bankCode');
  const accountNumber = map.get('--accountNumber');
  const accountName = map.get('--accountName');
  const businessAddress = map.get('--businessAddress');

  const required: [string, string | undefined][] = [
    ['--email', email],
    ['--businessName', businessName],
    ['--phone', phone],
    ['--bankName', bankName],
    ['--bankCode', bankCode],
    ['--accountNumber', accountNumber],
    ['--accountName', accountName],
  ];

  const missing = required.filter(([, v]) => !v).map(([k]) => k);
  if (missing.length > 0) {
    return {
      single: null,
      batchFile: null,
      error: `Missing required arguments: ${missing.join(', ')}`,
    };
  }

  return {
    single: {
      email: email!,
      businessName: businessName!,
      phone: phone!,
      bankName: bankName!,
      bankCode: bankCode!,
      accountNumber: accountNumber!,
      accountName: accountName!,
      businessAddress,
    },
    batchFile: null,
    error: null,
  };
}

function validateInput(input: MerchantInput): NormalizedMerchant | string {
  let normalizedEmail: string;
  try {
    normalizedEmail = normalizeEmail(input.email);
  } catch (e) {
    if (e instanceof InvalidEmailError) {
      return `Invalid email: ${input.email}`;
    }
    return `Unexpected error validating email: ${input.email}`;
  }

  let normalizedPhone: string;
  try {
    normalizedPhone = normalizePhone(input.phone);
  } catch (e) {
    if (e instanceof InvalidPhoneError) {
      return `Invalid phone number: ${input.phone}`;
    }
    return `Unexpected error validating phone: ${input.phone}`;
  }

  const businessName = input.businessName.trim();
  if (businessName.length === 0) {
    return 'businessName must be a non-empty string';
  }

  const bankName = input.bankName.trim();
  if (bankName.length < 2) {
    return `bankName must be at least 2 characters, got: "${input.bankName}"`;
  }

  if (!/^\d{3}$/.test(input.bankCode)) {
    return `bankCode must be exactly 3 digits, got: "${input.bankCode}"`;
  }

  if (!/^\d{10}$/.test(input.accountNumber)) {
    return `accountNumber must be exactly 10 digits, got: "${input.accountNumber}"`;
  }

  const accountName = input.accountName.trim();
  if (accountName.length < 2) {
    return `accountName must be at least 2 characters, got: "${input.accountName}"`;
  }

  return {
    email: normalizedEmail,
    businessName,
    phone: normalizedPhone,
    bankName,
    bankCode: input.bankCode,
    accountNumber: input.accountNumber,
    accountName,
    businessAddress: input.businessAddress?.trim(),
  };
}

async function registerMerchant(input: MerchantInput): Promise<string> {
  const validated = validateInput(input);
  if (typeof validated === 'string') {
    return `ERROR: ${validated}`;
  }

  const norm = validated;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const existing = await tx.user.findUnique({
        where: { email: norm.email },
      });

      if (existing) {
        return {
          kind: 'duplicate' as const,
          role: existing.role,
          status: existing.status,
        };
      }

      const userId = generateUserId();

      const user = await tx.user.create({
        data: {
          id: userId,
          email: norm.email,
          phone: norm.phone,
          role: 'MERCHANT',
          status: 'ACTIVE',
        },
      });

      await tx.merchantProfile.create({
        data: {
          userId: user.id,
          businessName: norm.businessName,
          businessAddress: norm.businessAddress || null,
          cashoutBankName: norm.bankName,
          cashoutBankCode: norm.bankCode,
          cashoutAccountNumber: norm.accountNumber,
          cashoutAccountName: norm.accountName,
        },
      });

      return { kind: 'ok' as const, user };
    });

    if (result.kind === 'duplicate') {
      return `ERROR: User with email "${norm.email}" already exists (role: ${result.role}, status: ${result.status}). Aborted.`;
    }

    const maskedAccount =
      norm.accountNumber.length >= 4
        ? `****${norm.accountNumber.slice(-4)}`
        : norm.accountNumber;

    return [
      '✓ Merchant registered',
      `  ID:       ${result.user.id}`,
      `  Email:    ${result.user.email}`,
      `  Business: ${norm.businessName}`,
      `  Bank:     ${norm.bankName} (${norm.bankCode}) ${maskedAccount}`,
      `  Phone:    ${result.user.phone}`,
    ].join('\n');
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return `ERROR: Database operation failed: ${message}`;
  }
}

async function processBatch(filePath: string): Promise<void> {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    console.error(`ERROR: Cannot read file: ${filePath}`);
    process.exit(1);
  }

  let merchants: MerchantInput[];
  try {
    merchants = JSON.parse(raw);
    if (!Array.isArray(merchants)) {
      throw new Error('File must contain a JSON array');
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`ERROR: Invalid JSON file: ${message}`);
    process.exit(1);
  }

  console.log(`Processing ${merchants.length} merchant(s)...\n`);

  let successCount = 0;
  let failureCount = 0;

  for (const merchant of merchants) {
    const result = await registerMerchant(merchant);
    console.log(result);
    console.log('');
    if (result.startsWith('✓')) {
      successCount++;
    } else {
      failureCount++;
    }
  }

  console.log(`Done: ${successCount} succeeded, ${failureCount} failed.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const { single, batchFile, error } = parseArgs(args);

  if (error) {
    console.error(`ERROR: ${error}`);
    console.error('');
    printUsage();
    process.exit(1);
  }

  if (batchFile) {
    await processBatch(batchFile);
  } else if (single) {
    const result = await registerMerchant(single);
    console.log(result);
  } else {
    printUsage();
    process.exit(1);
  }

  await prisma.$disconnect();
  process.exit(0);
}

main().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`FATAL: ${message}`);
  await prisma.$disconnect();
  process.exit(1);
});
