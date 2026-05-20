import { useCallback, useEffect, useState } from "react";
import { approveMerchant, getPendingMerchants } from "../api";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/ConfirmModal";
import { EmptyState } from "../components/EmptyState";
import type { PendingMerchant } from "../types";

export function PendingMerchantsPage() {
  const { markAnonymous } = useAuth();
  const [merchants, setMerchants] = useState<PendingMerchant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<PendingMerchant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPendingMerchants = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getPendingMerchants(markAnonymous);
      setMerchants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending merchants.");
    } finally {
      setIsLoading(false);
    }
  }, [markAnonymous]);

  useEffect(() => {
    void loadPendingMerchants();
  }, [loadPendingMerchants]);

  const handleApprove = async () => {
    if (!selectedMerchant) {
      return;
    }

    setIsApproving(true);
    setError(null);

    try {
      await approveMerchant(selectedMerchant.userId, markAnonymous);
      setSelectedMerchant(null);
      await loadPendingMerchants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve merchant.");
    } finally {
      setIsApproving(false);
    }
  };

  if (isLoading) {
    return (
      <section className="page-section">
        <div className="panel">
          <p className="supporting-text">Loading pending merchants...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="page-header-copy">
          <p className="page-eyebrow">Merchant onboarding</p>
          <h1 className="page-title">Pending Merchants</h1>
          <p className="page-description">
            Review merchant signup details before granting access to the existing merchant payment
            and cashout flow.
          </p>
        </div>
        <div className="page-meta">
          <span className="status-pill">
            {merchants.length} {merchants.length === 1 ? "request" : "requests"}
          </span>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {merchants.length === 0 ? (
        <EmptyState
          title="No merchants waiting for approval"
          description="New merchant signup requests will appear here when an account has completed OTP verification but is still pending admin approval."
        />
      ) : (
        <div className="panel table-card">
          <div className="table-card-header">
            <div>
              <h2 className="table-title">Approval queue</h2>
              <p className="table-note">
                Approving a merchant grants access to the existing merchant role only. It does not
                edit balances, cashouts, or user status beyond approval.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Payout details</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {merchants.map((merchant) => (
                  <tr key={merchant.userId}>
                    <td>
                      <div className="table-primary">
                        <span>{merchant.businessName ?? "Business name not provided"}</span>
                        <span className="table-secondary">{merchant.email}</span>
                        <span className="table-secondary mono">{merchant.userId}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span>{merchant.cashoutAccountName ?? "Account name missing"}</span>
                        <span className="table-secondary">
                          {merchant.cashoutBankName ?? "Bank not provided"}
                        </span>
                        <span className="table-secondary">
                          {merchant.cashoutAccountNumber ?? "Account number not provided"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span>{new Date(merchant.createdAt).toLocaleString()}</span>
                        <span className="table-secondary">
                          {merchant.businessAddress ?? "Address not provided"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span className="table-badge table-badge-warning">{merchant.status}</span>
                    </td>
                    <td className="table-action">
                      <button type="button" onClick={() => setSelectedMerchant(merchant)}>
                        Approve merchant
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        open={selectedMerchant !== null}
        title="Approve merchant account"
        body={
          selectedMerchant ? (
            <>
              <p>
                This approval marks <strong>{selectedMerchant.businessName ?? selectedMerchant.email}</strong>{" "}
                as an approved merchant in the existing admin flow.
              </p>
              <p>
                It allows the account to operate as a merchant and request cashouts through the
                current system. It does not manually edit balances, bypass reconciliation, or create
                any new permissions beyond merchant approval.
              </p>
              <ul className="modal-detail-list">
                <li>
                  <span className="modal-detail-label">Merchant</span>
                  <span className="modal-detail-value">
                    {selectedMerchant.businessName ?? selectedMerchant.email}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Email</span>
                  <span className="modal-detail-value">{selectedMerchant.email}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Payout account</span>
                  <span className="modal-detail-value">
                    {selectedMerchant.cashoutAccountName ?? "Not provided"} /{" "}
                    {selectedMerchant.cashoutAccountNumber ?? "Not provided"}
                  </span>
                </li>
              </ul>
            </>
          ) : null
        }
        confirmLabel="Approve merchant"
        isBusy={isApproving}
        onConfirm={handleApprove}
        onCancel={() => setSelectedMerchant(null)}
      />
    </section>
  );
}
