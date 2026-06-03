import { useEffect, useMemo, useState, type FormEvent } from "react";
import { getNgBanks, resolveBankAccount } from "../api";
import type {
  AdminBankOption,
  AdminMerchant,
  CreateAdminMerchantInput,
  ResolvedBankAccount,
} from "../types";

type MerchantFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  merchant: AdminMerchant | null;
  error: string | null;
  isBusy: boolean;
  onAuthFailure: () => void;
  onCancel: () => void;
  onSubmit: (values: CreateAdminMerchantInput) => void;
};

type ResolvedSnapshot = {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  bankName: string;
};

const EMPTY_VALUES: CreateAdminMerchantInput = {
  email: "",
  businessName: "",
  businessAddress: "",
  cashoutBankName: "",
  cashoutBankCode: "",
  cashoutAccountNumber: "",
  cashoutAccountName: "",
};

const BANK_LIST_LOAD_ERROR_MESSAGE =
  "Could not load Korapay banks. Check Korapay API configuration.";
const BANK_RESOLUTION_GATEWAY_ERROR_MESSAGE =
  "Could not resolve the bank account right now. Check Korapay API configuration.";

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function mapBankListError(error: unknown): string {
  return BANK_LIST_LOAD_ERROR_MESSAGE;
}

function mapResolveError(error: unknown): string {
  const message = toErrorMessage(error, "Failed to resolve bank account.");

  if (message === "korapay_bank_resolution_unavailable") {
    return BANK_RESOLUTION_GATEWAY_ERROR_MESSAGE;
  }

  return message;
}

function buildInitialValues(merchant: AdminMerchant | null): CreateAdminMerchantInput {
  if (!merchant) {
    return EMPTY_VALUES;
  }

  return {
    email: merchant.email,
    businessName: merchant.businessName ?? "",
    businessAddress: merchant.businessAddress ?? "",
    cashoutBankName: merchant.cashoutBankName ?? "",
    cashoutBankCode: merchant.cashoutBankCode ?? "",
    cashoutAccountNumber: merchant.cashoutAccountNumber ?? "",
    cashoutAccountName: merchant.cashoutAccountName ?? "",
  };
}

function buildInitialResolution(merchant: AdminMerchant | null): ResolvedSnapshot | null {
  if (
    !merchant?.cashoutBankCode ||
    !merchant.cashoutBankName ||
    !merchant.cashoutAccountNumber ||
    !merchant.cashoutAccountName
  ) {
    return null;
  }

  return {
    bankCode: merchant.cashoutBankCode,
    bankName: merchant.cashoutBankName,
    accountNumber: merchant.cashoutAccountNumber,
    accountName: merchant.cashoutAccountName,
  };
}

export function buildBankOptions(
  banks: readonly AdminBankOption[],
  merchant: AdminMerchant | null,
): AdminBankOption[] {
  const currentBankCode = merchant?.cashoutBankCode?.trim() ?? "";
  const currentBankName = merchant?.cashoutBankName?.trim() ?? "";

  if (currentBankCode.length === 0 || currentBankName.length === 0) {
    return [...banks];
  }

  const alreadyPresent = banks.some((bank) => bank.code === currentBankCode);
  if (alreadyPresent) {
    return [...banks];
  }

  return [
    {
      name: currentBankName,
      code: currentBankCode,
      countryCode: "NG",
    },
    ...banks,
  ];
}

export function isResolvedForCurrentValues(
  values: CreateAdminMerchantInput,
  resolution: ResolvedSnapshot | null,
): boolean {
  if (!resolution) {
    return false;
  }

  return (
    values.cashoutBankCode.trim() === resolution.bankCode &&
    values.cashoutAccountNumber.trim() === resolution.accountNumber &&
    values.cashoutAccountName.trim() === resolution.accountName &&
    values.cashoutBankName.trim() === resolution.bankName
  );
}

export function applyResolvedAccount(
  values: CreateAdminMerchantInput,
  account: ResolvedBankAccount,
): CreateAdminMerchantInput {
  return {
    ...values,
    cashoutBankCode: account.bankCode,
    cashoutBankName: account.bankName,
    cashoutAccountNumber: account.accountNumber,
    cashoutAccountName: account.accountName,
  };
}

export function MerchantFormModal({
  open,
  mode,
  merchant,
  error,
  isBusy,
  onAuthFailure,
  onCancel,
  onSubmit,
}: MerchantFormModalProps) {
  const [values, setValues] = useState<CreateAdminMerchantInput>(EMPTY_VALUES);
  const [banks, setBanks] = useState<AdminBankOption[]>([]);
  const [isLoadingBanks, setIsLoadingBanks] = useState(false);
  const [bankLoadError, setBankLoadError] = useState<string | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [isResolving, setIsResolving] = useState(false);
  const [resolution, setResolution] = useState<ResolvedSnapshot | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    setValues(mode === "create" ? EMPTY_VALUES : buildInitialValues(merchant));
    setResolution(mode === "create" ? null : buildInitialResolution(merchant));
    setResolveError(null);
    setBankLoadError(null);
  }, [merchant, mode, open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;

    const loadBanks = async () => {
      setIsLoadingBanks(true);

      try {
        const nextBanks = await getNgBanks(onAuthFailure);
        if (!cancelled) {
          setBanks(nextBanks);
        }
      } catch (loadError) {
        if (!cancelled) {
          setBankLoadError(mapBankListError(loadError));
        }
      } finally {
        if (!cancelled) {
          setIsLoadingBanks(false);
        }
      }
    };

    void loadBanks();

    return () => {
      cancelled = true;
    };
  }, [onAuthFailure, open]);

  const bankOptions = useMemo(() => buildBankOptions(banks, merchant), [banks, merchant]);

  useEffect(() => {
    const selectedBank = bankOptions.find((bank) => bank.code === values.cashoutBankCode.trim());
    if (!selectedBank) {
      return;
    }

    if (selectedBank.name === values.cashoutBankName) {
      return;
    }

    setValues((current) => ({
      ...current,
      cashoutBankName: selectedBank.name,
    }));
  }, [bankOptions, values.cashoutBankCode, values.cashoutBankName]);

  useEffect(() => {
    if (!resolution) {
      return;
    }

    if (
      values.cashoutBankCode.trim() === resolution.bankCode &&
      values.cashoutAccountNumber.trim() === resolution.accountNumber
    ) {
      return;
    }

    setResolution(null);
    setResolveError(null);
    setValues((current) => ({
      ...current,
      cashoutAccountName: "",
    }));
  }, [resolution, values.cashoutAccountNumber, values.cashoutBankCode]);

  if (!open) {
    return null;
  }

  const updateField = <K extends keyof CreateAdminMerchantInput>(
    field: K,
    value: CreateAdminMerchantInput[K],
  ) => {
    setValues((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const isCreateMode = mode === "create";
  const isResolved = isResolvedForCurrentValues(values, resolution);

  const canResolve =
    values.cashoutBankCode.trim().length > 0 &&
    /^\d{10}$/.test(values.cashoutAccountNumber.trim()) &&
    !isLoadingBanks &&
    !isBusy &&
    !isResolving;

  const canSubmit =
    !isBusy &&
    !isLoadingBanks &&
    isResolved &&
    values.cashoutBankName.trim().length > 0 &&
    values.cashoutBankCode.trim().length > 0 &&
    /^\d{10}$/.test(values.cashoutAccountNumber.trim());

  const handleResolve = async () => {
    if (values.cashoutBankCode.trim().length === 0) {
      setResolveError("Select a bank before resolving the account.");
      return;
    }

    if (!/^\d{10}$/.test(values.cashoutAccountNumber.trim())) {
      setResolveError("Enter a valid 10-digit account number before resolving.");
      return;
    }

    setResolveError(null);
    setIsResolving(true);

    try {
      const result = await resolveBankAccount(
        {
          bankCode: values.cashoutBankCode.trim(),
          accountNumber: values.cashoutAccountNumber.trim(),
        },
        onAuthFailure,
      );

      setValues((current) => applyResolvedAccount(current, result.account));
      setResolution({
        bankCode: result.account.bankCode,
        bankName: result.account.bankName,
        accountNumber: result.account.accountNumber,
        accountName: result.account.accountName,
      });
    } catch (resolveAccountError) {
      setResolution(null);
      setValues((current) => ({
        ...current,
        cashoutAccountName: "",
      }));
      setResolveError(mapResolveError(resolveAccountError));
    } finally {
      setIsResolving(false);
    }
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!isResolved) {
      setResolveError("Resolve the bank account before saving this merchant.");
      return;
    }

    onSubmit(values);
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="merchant-form-title">
      <div className="modal form-modal">
        <div className="modal-header">
          <p className="auth-eyebrow">{isCreateMode ? "Create merchant" : "Edit merchant"}</p>
          <h3 id="merchant-form-title">
            {isCreateMode ? "Create merchant account" : "Update merchant details"}
          </h3>
          <p className="modal-subtitle">
            {isCreateMode
              ? "Admin-created merchants become active immediately. This does not edit balances, ledger history, or user roles."
              : "Only safe merchant profile fields can be edited here. Email, status, balances, and role remain unchanged."}
          </p>
        </div>

        <form className="merchant-form" onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="field-group">
              <label htmlFor="merchant-email">Email</label>
              <input
                id="merchant-email"
                type="email"
                value={values.email}
                onChange={(event) => updateField("email", event.target.value)}
                disabled={!isCreateMode || isBusy}
                readOnly={!isCreateMode}
                required
                autoComplete="off"
              />
            </div>

            <div className="field-group">
              <label htmlFor="merchant-business-name">Business name</label>
              <input
                id="merchant-business-name"
                type="text"
                value={values.businessName}
                onChange={(event) => updateField("businessName", event.target.value)}
                disabled={isBusy}
                required
                maxLength={200}
              />
            </div>

            <div className="field-group form-grid-span-2">
              <label htmlFor="merchant-business-address">Business address</label>
              <textarea
                id="merchant-business-address"
                value={values.businessAddress}
                onChange={(event) => updateField("businessAddress", event.target.value)}
                disabled={isBusy}
                rows={3}
                maxLength={500}
              />
              <p className="field-note">Optional. Leave blank if the address is not available.</p>
            </div>

            <div className="field-group">
              <label htmlFor="merchant-bank-code">Cashout bank</label>
              <select
                id="merchant-bank-code"
                value={values.cashoutBankCode}
                onChange={(event) => updateField("cashoutBankCode", event.target.value)}
                disabled={isBusy || isLoadingBanks}
                required
              >
                <option value="">{isLoadingBanks ? "Loading banks..." : "Select bank"}</option>
                {bankOptions.map((bank) => (
                  <option key={`${bank.code}-${bank.name}`} value={bank.code}>
                    {bank.name}
                  </option>
                ))}
              </select>
              <p className="field-note">
                Bank options come from Korapay so the saved bank code matches payout requirements.
              </p>
            </div>

            <div className="field-group">
              <label htmlFor="merchant-bank-name">Resolved bank name</label>
              <input
                id="merchant-bank-name"
                type="text"
                value={values.cashoutBankName}
                disabled
                readOnly
              />
            </div>

            <div className="field-group">
              <label htmlFor="merchant-account-number">Cashout account number</label>
              <input
                id="merchant-account-number"
                type="text"
                value={values.cashoutAccountNumber}
                onChange={(event) => updateField("cashoutAccountNumber", event.target.value)}
                disabled={isBusy}
                required
                inputMode="numeric"
                pattern="[0-9]{10}"
                maxLength={10}
              />
            </div>

            <div className="field-group">
              <label htmlFor="merchant-account-name">Cashout account name</label>
              <input
                id="merchant-account-name"
                type="text"
                value={values.cashoutAccountName}
                onChange={(event) => updateField("cashoutAccountName", event.target.value)}
                disabled={isBusy || isResolved}
                readOnly={isResolved}
                required
                maxLength={200}
              />
            </div>

            <div className="field-group form-grid-span-2">
              <div className="inline-action-row">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    void handleResolve();
                  }}
                  disabled={!canResolve}
                >
                  {isResolving ? "Resolving..." : "Resolve account"}
                </button>
                <span className={isResolved ? "status-text success-text" : "status-text"}>
                  {isResolved
                    ? "Account resolved. The account name is now locked to the Korapay result."
                    : "Resolve this account before saving the merchant."}
                </span>
              </div>
            </div>
          </div>

          {bankLoadError ? <p className="error">{bankLoadError}</p> : null}
          {resolveError ? <p className="error">{resolveError}</p> : null}
          {error ? <p className="error">{error}</p> : null}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onCancel} disabled={isBusy}>
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit}>
              {isBusy
                ? "Saving..."
                : isCreateMode
                  ? "Create merchant"
                  : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
