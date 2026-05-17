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

export type PendingCashout = {
  id: string;
  merchantUserId: string;
  merchantBusinessName: string | null;
  amountKobo: string;
  requestedAt: string;
  status: string;
  cashoutBankName: string;
  cashoutBankCode: string;
  cashoutAccountNumber: string;
  cashoutAccountName: string;
};
