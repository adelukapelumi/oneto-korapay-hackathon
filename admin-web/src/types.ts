export type AdminOverview = {
  totalUsers: number;
  activeUsers: number;
  activeStudents: number;
  activeMerchants: number;
  pendingMerchants: number;
  pendingCashouts: number;
  flaggedUsers: number;
  frozenUsers: number;
};

export type ReconciliationReport = {
  sumAllVerifiedBalancesKobo: string;
  operatingBalanceKobo: string | null;
  operatingAccountPresent: boolean;
  invariantPasses: boolean;
  generatedAt: string;
};

export type PendingMerchant = {
  userId: string;
  email: string;
  createdAt: string;
  status: string;
  businessName: string | null;
  businessAddress: string | null;
  verifiedAt: string | null;
  cashoutBankName: string | null;
  cashoutBankCode: string | null;
  cashoutAccountNumber: string | null;
  cashoutAccountName: string | null;
};

export type AdminMerchant = {
  userId: string;
  email: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  businessName: string | null;
  businessAddress: string | null;
  cashoutBankName: string | null;
  cashoutBankCode: string | null;
  cashoutAccountNumber: string | null;
  cashoutAccountName: string | null;
  verifiedAt: string | null;
};

export type CreateAdminMerchantInput = {
  email: string;
  businessName: string;
  businessAddress: string;
  cashoutBankName: string;
  cashoutBankCode: string;
  cashoutAccountNumber: string;
  cashoutAccountName: string;
};

export type UpdateAdminMerchantInput = Partial<
  Omit<CreateAdminMerchantInput, "email">
>;

export type AdminBankOption = {
  name: string;
  code: string;
  countryCode: string;
};

export type ResolvedBankAccount = {
  accountName: string;
  accountNumber: string;
  bankCode: string;
  bankName: string;
};

export type PendingCashout = {
  id: string;
  merchantUserId: string;
  merchantBusinessName: string | null;
  amountKobo: string;
  grossAmountKobo: string;
  onetoFeeBps: number;
  onetoFeeKobo: string | null;
  korapayPayoutFeeKobo: string | null;
  korapayPayoutFeeBearer: "UNKNOWN" | "MERCHANT" | "ONETO" | string;
  korapayPayoutFeeDeductedFromRecipient: boolean | null;
  netPayoutKobo: string | null;
  korapayTransferAmountKobo: string | null;
  amountToPayKobo: string | null;
  payoutMode: "korapay_api" | "manual" | string;
  manualPayoutRequired: boolean;
  requestedAt: string;
  status: string;
  cashoutBankName: string;
  cashoutBankCode: string;
  cashoutAccountNumber: string;
  cashoutAccountName: string;
};
