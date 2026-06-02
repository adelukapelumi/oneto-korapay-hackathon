import { useEffect, useState } from "react";
import {
  createMerchant,
  deactivateMerchant,
  getMerchants,
  reactivateMerchant,
  updateMerchant,
} from "../api";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/ConfirmModal";
import { EmptyState } from "../components/EmptyState";
import { MerchantFormModal } from "../components/MerchantFormModal";
import type {
  AdminMerchant,
  CreateAdminMerchantInput,
  UpdateAdminMerchantInput,
} from "../types";

type StatusFilterValue = "ALL" | "ACTIVE" | "FROZEN" | "FLAGGED" | "PENDING_VERIFICATION";

type MerchantActionState =
  | {
      kind: "deactivate" | "reactivate";
      merchant: AdminMerchant;
    }
  | null;

const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: StatusFilterValue;
  label: string;
}> = [
  { value: "ALL", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "FROZEN", label: "Frozen" },
  { value: "FLAGGED", label: "Flagged" },
  { value: "PENDING_VERIFICATION", label: "Pending" },
];

function formatDateTime(value: string | null) {
  if (!value) {
    return "Not verified";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function normalizeValue(value: string) {
  return value.trim();
}

function maskAccountNumber(accountNumber: string | null) {
  if (!accountNumber) {
    return "Not provided";
  }

  const visibleDigits = accountNumber.slice(-4);
  const hiddenLength = Math.max(accountNumber.length - visibleDigits.length, 0);
  return `${"*".repeat(hiddenLength)}${visibleDigits}`;
}

function formatStatusLabel(status: string) {
  switch (status) {
    case "ACTIVE":
      return "Active";
    case "FROZEN":
      return "Frozen";
    case "FLAGGED":
      return "Flagged";
    case "PENDING_VERIFICATION":
      return "Pending";
    default:
      return status.replace(/_/g, " ");
  }
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "ACTIVE":
      return "table-badge table-badge-success";
    case "FROZEN":
      return "table-badge table-badge-warning";
    case "FLAGGED":
      return "table-badge table-badge-danger";
    default:
      return "table-badge";
  }
}

function getMerchantDisplayName(merchant: AdminMerchant) {
  return merchant.businessName ?? merchant.email;
}

function buildCreatePayload(values: CreateAdminMerchantInput): CreateAdminMerchantInput {
  return {
    email: normalizeValue(values.email),
    businessName: normalizeValue(values.businessName),
    businessAddress: normalizeValue(values.businessAddress),
    cashoutBankName: normalizeValue(values.cashoutBankName),
    cashoutBankCode: normalizeValue(values.cashoutBankCode),
    cashoutAccountNumber: normalizeValue(values.cashoutAccountNumber),
    cashoutAccountName: normalizeValue(values.cashoutAccountName),
  };
}

function buildUpdatePayload(
  merchant: AdminMerchant,
  values: CreateAdminMerchantInput,
): UpdateAdminMerchantInput {
  const payload: UpdateAdminMerchantInput = {};

  const nextBusinessName = normalizeValue(values.businessName);
  const nextBusinessAddress = normalizeValue(values.businessAddress);
  const nextCashoutBankName = normalizeValue(values.cashoutBankName);
  const nextCashoutBankCode = normalizeValue(values.cashoutBankCode);
  const nextCashoutAccountNumber = normalizeValue(values.cashoutAccountNumber);
  const nextCashoutAccountName = normalizeValue(values.cashoutAccountName);

  if (nextBusinessName !== (merchant.businessName ?? "")) {
    payload.businessName = nextBusinessName;
  }
  if (nextBusinessAddress !== (merchant.businessAddress ?? "")) {
    payload.businessAddress = nextBusinessAddress;
  }
  if (nextCashoutBankName !== (merchant.cashoutBankName ?? "")) {
    payload.cashoutBankName = nextCashoutBankName;
  }
  if (nextCashoutBankCode !== (merchant.cashoutBankCode ?? "")) {
    payload.cashoutBankCode = nextCashoutBankCode;
  }
  if (nextCashoutAccountNumber !== (merchant.cashoutAccountNumber ?? "")) {
    payload.cashoutAccountNumber = nextCashoutAccountNumber;
  }
  if (nextCashoutAccountName !== (merchant.cashoutAccountName ?? "")) {
    payload.cashoutAccountName = nextCashoutAccountName;
  }

  return payload;
}

export function MerchantsPage() {
  const { markAnonymous } = useAuth();
  const [merchants, setMerchants] = useState<AdminMerchant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("ALL");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingMerchant, setEditingMerchant] = useState<AdminMerchant | null>(null);
  const [pendingAction, setPendingAction] = useState<MerchantActionState>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isConfirmingAction, setIsConfirmingAction] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadMerchants = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const merchantData = await getMerchants(markAnonymous);
        if (!cancelled) {
          setMerchants(merchantData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load merchants.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadMerchants();

    return () => {
      cancelled = true;
    };
  }, [markAnonymous]);

  const refreshMerchants = async () => {
    const merchantData = await getMerchants(markAnonymous);
    setMerchants(merchantData);
  };

  const filteredMerchants = merchants.filter((merchant) => {
    const matchesStatus = statusFilter === "ALL" || merchant.status === statusFilter;
    const normalizedQuery = searchQuery.trim().toLowerCase();
    const matchesQuery =
      normalizedQuery.length === 0 ||
      (merchant.businessName ?? "").toLowerCase().includes(normalizedQuery) ||
      merchant.email.toLowerCase().includes(normalizedQuery);

    return matchesStatus && matchesQuery;
  });

  const openCreateModal = () => {
    setFormError(null);
    setIsCreateModalOpen(true);
  };

  const openEditModal = (merchant: AdminMerchant) => {
    setFormError(null);
    setEditingMerchant(merchant);
  };

  const closeFormModal = () => {
    if (isSaving) {
      return;
    }

    setFormError(null);
    setIsCreateModalOpen(false);
    setEditingMerchant(null);
  };

  const handleCreateMerchant = async (values: CreateAdminMerchantInput) => {
    setIsSaving(true);
    setFormError(null);
    setError(null);

    try {
      await createMerchant(buildCreatePayload(values), markAnonymous);
      await refreshMerchants();
      setIsCreateModalOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create merchant.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleEditMerchant = async (values: CreateAdminMerchantInput) => {
    if (!editingMerchant) {
      return;
    }

    const nextBusinessAddress = normalizeValue(values.businessAddress);
    if (nextBusinessAddress.length === 0 && (editingMerchant.businessAddress ?? "").length > 0) {
      setFormError("Clearing an existing business address is not supported by the current API.");
      return;
    }

    const payload = buildUpdatePayload(editingMerchant, values);
    if (Object.keys(payload).length === 0) {
      setFormError("No merchant fields changed.");
      return;
    }

    setIsSaving(true);
    setFormError(null);
    setError(null);

    try {
      await updateMerchant(editingMerchant.userId, payload, markAnonymous);
      await refreshMerchants();
      setEditingMerchant(null);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to update merchant.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleConfirmAction = async () => {
    if (!pendingAction) {
      return;
    }

    setIsConfirmingAction(true);
    setError(null);

    try {
      if (pendingAction.kind === "deactivate") {
        await deactivateMerchant(pendingAction.merchant.userId, markAnonymous);
      } else {
        await reactivateMerchant(pendingAction.merchant.userId, markAnonymous);
      }

      setPendingAction(null);
      await refreshMerchants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update merchant status.");
    } finally {
      setIsConfirmingAction(false);
    }
  };

  const pageCountLabel = `${filteredMerchants.length} ${
    filteredMerchants.length === 1 ? "merchant" : "merchants"
  }`;

  if (isLoading) {
    return (
      <section className="page-section">
        <div className="panel">
          <p className="supporting-text">Loading merchants...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="page-header-copy">
          <p className="page-eyebrow">Merchant operations</p>
          <h1 className="page-title">Merchants</h1>
          <p className="page-description">
            Manage merchant records without touching balances, ledger history, or payout approval
            logic.
          </p>
        </div>
        <div className="page-meta">
          <span className="status-pill">{pageCountLabel}</span>
          <button type="button" onClick={openCreateModal}>
            Create merchant
          </button>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <div className="panel page-toolbar">
        <div className="toolbar-group toolbar-search">
          <label htmlFor="merchant-search">Search</label>
          <input
            id="merchant-search"
            type="search"
            placeholder="Search by business name or email"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <div className="toolbar-group toolbar-filter">
          <label htmlFor="merchant-status-filter">Status</label>
          <select
            id="merchant-status-filter"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilterValue)}
          >
            {STATUS_FILTER_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {filteredMerchants.length === 0 ? (
        <div className="page-section">
          <EmptyState
            title={
              merchants.length === 0
                ? "No merchants found"
                : "No merchants match this filter"
            }
            description={
              merchants.length === 0
                ? "Create a merchant account to make them available for admin-managed merchant operations."
                : "Try a different search term or switch the status filter back to All."
            }
          />
        </div>
      ) : (
        <div className="panel table-card">
          <div className="table-card-header">
            <div>
              <h2 className="table-title">Merchant directory</h2>
              <p className="table-note">
                This page only manages merchant profile details and active visibility in the
                student merchant list.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Status</th>
                  <th>Payout details</th>
                  <th>Timestamps</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredMerchants.map((merchant) => (
                  <tr key={merchant.userId}>
                    <td>
                      <div className="table-primary">
                        <span>{merchant.businessName ?? "Business name not provided"}</span>
                        <span className="table-secondary">{merchant.email}</span>
                        <span className="table-secondary">
                          {merchant.businessAddress ?? "Address not provided"}
                        </span>
                        <span className="table-secondary mono">{merchant.userId}</span>
                      </div>
                    </td>
                    <td>
                      <div className="status-stack">
                        <span className={getStatusBadgeClass(merchant.status)}>
                          {formatStatusLabel(merchant.status)}
                        </span>
                        <span className="table-secondary">
                          Verified: {formatDateTime(merchant.verifiedAt)}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span>{merchant.cashoutBankName ?? "Bank not provided"}</span>
                        <span className="table-secondary">
                          {merchant.cashoutAccountName ?? "Account name missing"}
                        </span>
                        <span className="table-secondary">
                          {maskAccountNumber(merchant.cashoutAccountNumber)}
                          {merchant.cashoutBankCode ? ` • Code ${merchant.cashoutBankCode}` : ""}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span>Created: {formatDateTime(merchant.createdAt)}</span>
                        <span className="table-secondary">
                          Updated: {formatDateTime(merchant.updatedAt)}
                        </span>
                      </div>
                    </td>
                    <td className="table-action">
                      <div className="table-actions">
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => openEditModal(merchant)}
                        >
                          Edit
                        </button>

                        {merchant.status !== "FROZEN" && merchant.status !== "FLAGGED" ? (
                          <button
                            type="button"
                            className="secondary danger"
                            onClick={() => setPendingAction({ kind: "deactivate", merchant })}
                          >
                            Deactivate
                          </button>
                        ) : null}

                        {merchant.status === "FROZEN" ? (
                          <button
                            type="button"
                            className="secondary"
                            onClick={() => setPendingAction({ kind: "reactivate", merchant })}
                          >
                            Reactivate
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <MerchantFormModal
        open={isCreateModalOpen}
        mode="create"
        merchant={null}
        error={formError}
        isBusy={isSaving}
        onAuthFailure={markAnonymous}
        onCancel={closeFormModal}
        onSubmit={handleCreateMerchant}
      />

      <MerchantFormModal
        open={editingMerchant !== null}
        mode="edit"
        merchant={editingMerchant}
        error={formError}
        isBusy={isSaving}
        onAuthFailure={markAnonymous}
        onCancel={closeFormModal}
        onSubmit={handleEditMerchant}
      />

      <ConfirmModal
        open={pendingAction !== null}
        title={
          pendingAction?.kind === "deactivate"
            ? "Deactivate merchant"
            : "Reactivate merchant"
        }
        body={
          pendingAction ? (
            <>
              <p>
                <strong>{getMerchantDisplayName(pendingAction.merchant)}</strong>
              </p>
              <p>
                {pendingAction.kind === "deactivate"
                  ? "This merchant will stop appearing in the student payment list. Existing balances, ledger entries, and history will not be deleted."
                  : "This merchant will become eligible to appear in the student merchant list again if verified."}
              </p>
              <ul className="modal-detail-list">
                <li>
                  <span className="modal-detail-label">Email</span>
                  <span className="modal-detail-value">{pendingAction.merchant.email}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Current status</span>
                  <span className="modal-detail-value">
                    {formatStatusLabel(pendingAction.merchant.status)}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Verified</span>
                  <span className="modal-detail-value">
                    {formatDateTime(pendingAction.merchant.verifiedAt)}
                  </span>
                </li>
              </ul>
            </>
          ) : null
        }
        confirmLabel={pendingAction?.kind === "deactivate" ? "Deactivate merchant" : "Reactivate merchant"}
        isBusy={isConfirmingAction}
        onConfirm={handleConfirmAction}
        onCancel={() => {
          if (!isConfirmingAction) {
            setPendingAction(null);
          }
        }}
      />
    </section>
  );
}
