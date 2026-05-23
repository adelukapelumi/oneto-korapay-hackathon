import { useCallback, useEffect, useState } from "react";
import { approveCashout, getPendingCashouts } from "../api";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/ConfirmModal";
import { EmptyState } from "../components/EmptyState";
import type { PendingCashout } from "../types";

const countFormatter = new Intl.NumberFormat("en-NG");

function formatNgnFromKobo(amountKobo: string) {
  try {
    const parsed = BigInt(amountKobo);
    const isNegative = parsed < 0n;
    const absoluteAmount = isNegative ? -parsed : parsed;
    const naira = absoluteAmount / 100n;
    const kobo = (absoluteAmount % 100n).toString().padStart(2, "0");
    return `${isNegative ? "-" : ""}NGN ${countFormatter.format(naira)}.${kobo}`;
  } catch {
    return `${amountKobo} kobo`;
  }
}

function formatOptionalNgnFromKobo(amountKobo: string | null, fallback: string) {
  return amountKobo === null ? fallback : formatNgnFromKobo(amountKobo);
}

export function PendingCashoutsPage() {
  const { markAnonymous } = useAuth();
  const [cashouts, setCashouts] = useState<PendingCashout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [selectedCashout, setSelectedCashout] = useState<PendingCashout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPendingCashouts = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getPendingCashouts(markAnonymous);
      setCashouts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending cashouts.");
    } finally {
      setIsLoading(false);
    }
  }, [markAnonymous]);

  useEffect(() => {
    void loadPendingCashouts();
  }, [loadPendingCashouts]);

  const handleApprove = async () => {
    if (!selectedCashout) {
      return;
    }

    setIsApproving(true);
    setError(null);

    try {
      await approveCashout(selectedCashout.id, markAnonymous);
      setSelectedCashout(null);
      await loadPendingCashouts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve cashout.");
    } finally {
      setIsApproving(false);
    }
  };

  if (isLoading) {
    return (
      <section className="page-section">
        <div className="panel">
          <p className="supporting-text">Loading pending cashouts...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="page-header-copy">
          <p className="page-eyebrow">Cashout review</p>
          <h1 className="page-title">Pending Cashouts</h1>
          <p className="page-description">
            Review merchant payout requests carefully. Cashout approvals should only happen after
            reconciliation health has been checked.
          </p>
        </div>
        <div className="page-meta">
          <span className="status-pill">
            {cashouts.length} {cashouts.length === 1 ? "request" : "requests"}
          </span>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {cashouts.length === 0 ? (
        <EmptyState
          title="No cashouts waiting for approval"
          description="Merchant cashout requests will appear here after they have been submitted and are waiting for manual admin review."
        />
      ) : (
        <div className="panel table-card">
          <div className="table-card-header">
            <div>
              <h2 className="table-title">Approval queue</h2>
              <p className="table-note">
                Amounts below are shown in naira for review while keeping the existing backend
                approval flow unchanged.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Payout account</th>
                  <th>Amount</th>
                  <th>Requested</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {cashouts.map((cashout) => (
                  <tr key={cashout.id}>
                    <td>
                      <div className="table-primary">
                        <span>{cashout.merchantBusinessName ?? "Merchant business not provided"}</span>
                        <span className="table-secondary mono">{cashout.merchantUserId}</span>
                        <span className="table-secondary mono">{cashout.id}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span>{cashout.cashoutAccountName}</span>
                        <span className="table-secondary">{cashout.cashoutBankName}</span>
                        <span className="table-secondary">{cashout.cashoutAccountNumber}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span className="amount-value">{formatNgnFromKobo(cashout.grossAmountKobo)}</span>
                        <span className="table-secondary">
                          Oneto fee: {formatOptionalNgnFromKobo(cashout.onetoFeeKobo, "pending")}
                        </span>
                        <span className="table-secondary">
                          Korapay fee: {formatOptionalNgnFromKobo(cashout.korapayPayoutFeeKobo, "Korapay payout fee pending confirmation.")}
                        </span>
                        <span className="table-secondary">
                          Net payout: {formatOptionalNgnFromKobo(cashout.netPayoutKobo, "pending payout fee")}
                        </span>
                      </div>
                    </td>
                    <td>{new Date(cashout.requestedAt).toLocaleString()}</td>
                    <td>
                      <span className="table-badge table-badge-warning">{cashout.status}</span>
                    </td>
                    <td className="table-action">
                      <button type="button" onClick={() => setSelectedCashout(cashout)}>
                        Approve cashout
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
        open={selectedCashout !== null}
        title="Approve merchant cashout"
        body={
          selectedCashout ? (
            <>
              <p>
                This approval triggers the existing cashout approval flow for{" "}
                <strong>
                  {selectedCashout.merchantBusinessName ?? selectedCashout.merchantUserId}
                </strong>
                .
              </p>
              <p>
                Approval debits the merchant by the gross settled balance. The backend sends gross
                minus Oneto's service fee to Korapay, then records Korapay's payout fee when the
                gateway confirms it.
              </p>
              <p>
                Treat Korapay's payout fee as merchant-borne only if the fee is deducted from the
                transfer amount. If Korapay charges Oneto separately, handle it as a processor
                expense until a reliable fee-before-payout method exists.
              </p>
              <ul className="modal-detail-list">
                <li>
                  <span className="modal-detail-label">Cashout ID</span>
                  <span className="modal-detail-value mono">{selectedCashout.id}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Merchant</span>
                  <span className="modal-detail-value">
                    {selectedCashout.merchantBusinessName ?? selectedCashout.merchantUserId}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Gross cashout</span>
                  <span className="modal-detail-value">
                    {formatNgnFromKobo(selectedCashout.grossAmountKobo)}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Oneto fee</span>
                  <span className="modal-detail-value">
                    {formatOptionalNgnFromKobo(selectedCashout.onetoFeeKobo, "pending")} at{" "}
                    {selectedCashout.onetoFeeBps / 100}%
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Korapay payout fee</span>
                  <span className="modal-detail-value">
                    {formatOptionalNgnFromKobo(selectedCashout.korapayPayoutFeeKobo, "Korapay payout fee pending confirmation.")}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Net payout</span>
                  <span className="modal-detail-value">
                    {formatOptionalNgnFromKobo(selectedCashout.netPayoutKobo, "pending payout fee")}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Payout before Korapay fee</span>
                  <span className="modal-detail-value">
                    {formatOptionalNgnFromKobo(
                      selectedCashout.payoutAmountBeforeKorapayFeeKobo,
                      "set during approval",
                    )}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Payout account</span>
                  <span className="modal-detail-value">
                    {selectedCashout.cashoutAccountName} / {selectedCashout.cashoutAccountNumber}
                  </span>
                </li>
              </ul>
            </>
          ) : null
        }
        confirmLabel="Approve cashout"
        isBusy={isApproving}
        onConfirm={handleApprove}
        onCancel={() => setSelectedCashout(null)}
      />
    </section>
  );
}
