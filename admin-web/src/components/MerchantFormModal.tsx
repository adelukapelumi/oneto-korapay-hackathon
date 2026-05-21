import { useEffect, useState, type FormEvent } from "react";
import type { AdminMerchant, CreateAdminMerchantInput } from "../types";

type MerchantFormModalProps = {
  open: boolean;
  mode: "create" | "edit";
  merchant: AdminMerchant | null;
  error: string | null;
  isBusy: boolean;
  onCancel: () => void;
  onSubmit: (values: CreateAdminMerchantInput) => void;
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

export function MerchantFormModal({
  open,
  mode,
  merchant,
  error,
  isBusy,
  onCancel,
  onSubmit,
}: MerchantFormModalProps) {
  const [values, setValues] = useState<CreateAdminMerchantInput>(EMPTY_VALUES);

  useEffect(() => {
    if (!open) {
      return;
    }

    setValues(mode === "create" ? EMPTY_VALUES : buildInitialValues(merchant));
  }, [merchant, mode, open]);

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSubmit(values);
  };

  const isCreateMode = mode === "create";

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
              <label htmlFor="merchant-bank-name">Cashout bank name</label>
              <input
                id="merchant-bank-name"
                type="text"
                value={values.cashoutBankName}
                onChange={(event) => updateField("cashoutBankName", event.target.value)}
                disabled={isBusy}
                required
                maxLength={100}
              />
            </div>

            <div className="field-group">
              <label htmlFor="merchant-bank-code">Cashout bank code</label>
              <input
                id="merchant-bank-code"
                type="text"
                value={values.cashoutBankCode}
                onChange={(event) => updateField("cashoutBankCode", event.target.value)}
                disabled={isBusy}
                required
                inputMode="numeric"
                pattern="[0-9]{3}"
                maxLength={3}
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
                disabled={isBusy}
                required
                maxLength={200}
              />
            </div>
          </div>

          {error ? <p className="error">{error}</p> : null}

          <div className="modal-actions">
            <button type="button" className="secondary" onClick={onCancel} disabled={isBusy}>
              Cancel
            </button>
            <button type="submit" disabled={isBusy}>
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
