import { useCallback, useEffect, useMemo, useState } from "react";
import {
  approveCashout,
  cancelManualCashout,
  getCashoutOperations,
  markManualCashoutPaid,
} from "../api";
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

function getAmountToPayKobo(cashout: PendingCashout): string | null {
  return cashout.amountToPayKobo ?? cashout.korapayTransferAmountKobo;
}

function formatPayoutMode(mode: PendingCashout["payoutMode"]) {
  return mode === "manual" ? "manual" : "korapay_api";
}

export function PendingCashoutsPage() {
  const { markAnonymous } = useAuth();
  const [cashouts, setCashouts] = useState<PendingCashout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isWorking, setIsWorking] = useState(false);
  const [workingCashoutId, setWorkingCashoutId] = useState<string | null>(null);
  const [selectedApprovalCashout, setSelectedApprovalCashout] = useState<PendingCashout | null>(null);
  const [selectedMarkPaidCashout, setSelectedMarkPaidCashout] = useState<PendingCashout | null>(null);
  const [selectedCancelCashout, setSelectedCancelCashout] = useState<PendingCashout | null>(null);
  const [externalReference, setExternalReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadCashoutOperations = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getCashoutOperations(markAnonymous);
      setCashouts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load cashout operations.");
    } finally {
      setIsLoading(false);
    }
  }, [markAnonymous]);

  useEffect(() => {
    void loadCashoutOperations();
  }, [loadCashoutOperations]);

  const pendingCashouts = useMemo(
    () => cashouts.filter((cashout) => cashout.status === "PENDING"),
    [cashouts],
  );
  const manualProcessingCashouts = useMemo(
    () =>
      cashouts.filter(
        (cashout) =>
          cashout.status === "PROCESSING" &&
          (cashout.manualPayoutRequired || cashout.payoutMode === "manual"),
      ),
    [cashouts],
  );

  const handleApprove = async () => {
    if (!selectedApprovalCashout) {
      return;
    }

    setIsWorking(true);
    setWorkingCashoutId(selectedApprovalCashout.id);
    setError(null);
    setNotice(null);

    try {
      const approvedCashoutId = selectedApprovalCashout.id;
      const result = await approveCashout(approvedCashoutId, markAnonymous);
      setSelectedApprovalCashout(null);

      if (result.status === "FAILED") {
        setNotice(`Cashout failed: ${result.failureReason ?? "payout_gateway_error"}`);
      } else if (result.payoutMode === "manual") {
        const manualAmount =
          result.amountToPayKobo ?? getAmountToPayKobo(selectedApprovalCashout) ?? "0";
        setNotice(
          `Manual payout required. Pay ${formatNgnFromKobo(
            manualAmount,
          )} to merchant, then mark as paid.`,
        );
      } else {
        setNotice("Cashout approval submitted; payout processing.");
      }

      await loadCashoutOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve cashout.");
    } finally {
      setIsWorking(false);
      setWorkingCashoutId(null);
    }
  };

  const openMarkPaidModal = (cashout: PendingCashout) => {
    setExternalReference("");
    setNote("");
    setSelectedMarkPaidCashout(cashout);
    setError(null);
    setNotice(null);
  };

  const handleMarkPaid = async () => {
    if (!selectedMarkPaidCashout) {
      return;
    }

    if (externalReference.trim().length === 0) {
      setError("External reference is required.");
      return;
    }

    setIsWorking(true);
    setWorkingCashoutId(selectedMarkPaidCashout.id);
    setError(null);
    setNotice(null);

    try {
      await markManualCashoutPaid(
        selectedMarkPaidCashout.id,
        {
          externalReference: externalReference.trim(),
          note: note.trim() || undefined,
        },
        markAnonymous,
      );
      setSelectedMarkPaidCashout(null);
      setNotice("Manual cashout marked as paid.");
      await loadCashoutOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to mark cashout as paid.");
    } finally {
      setIsWorking(false);
      setWorkingCashoutId(null);
    }
  };

  const handleCancelManualPayout = async () => {
    if (!selectedCancelCashout) {
      return;
    }

    setIsWorking(true);
    setWorkingCashoutId(selectedCancelCashout.id);
    setError(null);
    setNotice(null);

    try {
      await cancelManualCashout(selectedCancelCashout.id, markAnonymous);
      setSelectedCancelCashout(null);
      setNotice("Manual payout cancelled and merchant reservation reversed.");
      await loadCashoutOperations();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel manual payout.");
    } finally {
      setIsWorking(false);
      setWorkingCashoutId(null);
    }
  };

  if (isLoading) {
    return (
      <section className="page-section">
        <div className="panel">
          <p className="supporting-text">Loading cashout operations...</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="page-header-copy">
          <p className="page-eyebrow">Cashout review</p>
          <h1 className="page-title">Cashout Operations</h1>
          <p className="page-description">
            Approve pending requests, execute manual payouts, and only mark paid after real transfer
            completion.
          </p>
        </div>
        <div className="page-meta">
          <span className="status-pill">
            {pendingCashouts.length} pending
          </span>
          <span className="status-pill">
            {manualProcessingCashouts.length} manual processing
          </span>
        </div>
      </div>

      {notice ? <p className="message">{notice}</p> : null}
      {error ? <p className="error">{error}</p> : null}

      {pendingCashouts.length === 0 ? (
        <EmptyState
          title="No pending cashouts"
          description="Merchant cashout requests awaiting approval will appear here."
        />
      ) : (
        <div className="panel table-card">
          <div className="table-card-header">
            <div>
              <h2 className="table-title">Pending approvals</h2>
              <p className="table-note">
                In manual mode, approval reserves balances and creates ledger entries before transfer.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Payout mode</th>
                  <th>Payout account</th>
                  <th>Amounts</th>
                  <th>Requested</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {pendingCashouts.map((cashout) => (
                  <tr key={cashout.id}>
                    <td>
                      <div className="table-primary">
                        <span>{cashout.merchantBusinessName ?? "Merchant business not provided"}</span>
                        <span className="table-secondary mono">{cashout.merchantUserId}</span>
                        <span className="table-secondary mono">{cashout.id}</span>
                      </div>
                    </td>
                    <td>
                      <span className="table-badge table-badge-warning">
                        {formatPayoutMode(cashout.payoutMode)}
                      </span>
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
                          Amount to pay:{" "}
                          {formatOptionalNgnFromKobo(getAmountToPayKobo(cashout), "set during approval")}
                        </span>
                      </div>
                    </td>
                    <td>{new Date(cashout.requestedAt).toLocaleString()}</td>
                    <td className="table-action">
                      <button
                        type="button"
                        onClick={() => setSelectedApprovalCashout(cashout)}
                        disabled={isWorking}
                      >
                        {isWorking && workingCashoutId === cashout.id
                          ? "Approving..."
                          : cashout.payoutMode === "manual"
                            ? "Approve for manual payout"
                            : "Approve cashout"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {manualProcessingCashouts.length > 0 ? (
        <div className="panel table-card">
          <div className="table-card-header">
            <div>
              <h2 className="table-title">Manual payout queue</h2>
              <p className="table-note">
                Manual payout required. Pay merchant first, then mark as paid.
              </p>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Merchant</th>
                  <th>Amount to pay</th>
                  <th>Payout account</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {manualProcessingCashouts.map((cashout) => (
                  <tr key={cashout.id}>
                    <td>
                      <div className="table-primary">
                        <span>{cashout.merchantBusinessName ?? cashout.merchantUserId}</span>
                        <span className="table-secondary mono">{cashout.id}</span>
                      </div>
                    </td>
                    <td>{formatOptionalNgnFromKobo(getAmountToPayKobo(cashout), "pending")}</td>
                    <td>
                      <div className="table-primary">
                        <span>{cashout.cashoutAccountName}</span>
                        <span className="table-secondary">{cashout.cashoutBankName}</span>
                        <span className="table-secondary">{cashout.cashoutAccountNumber}</span>
                      </div>
                    </td>
                    <td>
                      <span className="table-badge table-badge-warning">{cashout.status}</span>
                    </td>
                    <td className="table-action">
                      <button
                        type="button"
                        onClick={() => openMarkPaidModal(cashout)}
                        disabled={isWorking}
                      >
                        Mark as paid
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => setSelectedCancelCashout(cashout)}
                        disabled={isWorking}
                      >
                        Cancel manual payout
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <ConfirmModal
        open={selectedApprovalCashout !== null}
        title={selectedApprovalCashout?.payoutMode === "manual" ? "Approve for manual payout" : "Approve merchant cashout"}
        body={
          selectedApprovalCashout ? (
            <>
              <p>
                This approval reserves merchant funds and updates the ledger atomically. In manual
                payout mode, do the real transfer outside Oneto, then mark as paid.
              </p>
              <ul className="modal-detail-list">
                <li>
                  <span className="modal-detail-label">Cashout ID</span>
                  <span className="modal-detail-value mono">{selectedApprovalCashout.id}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Payout mode</span>
                  <span className="modal-detail-value">{formatPayoutMode(selectedApprovalCashout.payoutMode)}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Gross cashout</span>
                  <span className="modal-detail-value">
                    {formatNgnFromKobo(selectedApprovalCashout.grossAmountKobo)}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Oneto fee</span>
                  <span className="modal-detail-value">
                    {formatOptionalNgnFromKobo(selectedApprovalCashout.onetoFeeKobo, "pending")}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Amount to pay</span>
                  <span className="modal-detail-value">
                    {formatOptionalNgnFromKobo(getAmountToPayKobo(selectedApprovalCashout), "set during approval")}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">Payout account</span>
                  <span className="modal-detail-value">
                    {selectedApprovalCashout.cashoutAccountName} / {selectedApprovalCashout.cashoutAccountNumber}
                  </span>
                </li>
              </ul>
            </>
          ) : null
        }
        confirmLabel={
          selectedApprovalCashout?.payoutMode === "manual"
            ? "Approve for manual payout"
            : "Approve cashout"
        }
        isBusy={isWorking}
        onConfirm={handleApprove}
        onCancel={() => setSelectedApprovalCashout(null)}
      />

      <ConfirmModal
        open={selectedMarkPaidCashout !== null}
        title="Mark manual payout as paid"
        body={
          selectedMarkPaidCashout ? (
            <>
              <p>
                Only mark paid after you have actually sent the bank transfer.
              </p>
              <ul className="modal-detail-list">
                <li>
                  <span className="modal-detail-label">Cashout ID</span>
                  <span className="modal-detail-value mono">{selectedMarkPaidCashout.id}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Amount to pay</span>
                  <span className="modal-detail-value">
                    {formatOptionalNgnFromKobo(getAmountToPayKobo(selectedMarkPaidCashout), "pending")}
                  </span>
                </li>
              </ul>
              <div className="field-group">
                <label htmlFor="externalReference">External reference</label>
                <input
                  id="externalReference"
                  value={externalReference}
                  onChange={(event) => setExternalReference(event.target.value)}
                  placeholder="bank transfer reference"
                />
              </div>
              <div className="field-group">
                <label htmlFor="markPaidNote">Note (optional)</label>
                <textarea
                  id="markPaidNote"
                  rows={3}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="optional operator note"
                />
              </div>
            </>
          ) : null
        }
        confirmLabel="Mark as paid"
        isBusy={isWorking}
        onConfirm={handleMarkPaid}
        onCancel={() => setSelectedMarkPaidCashout(null)}
      />

      <ConfirmModal
        open={selectedCancelCashout !== null}
        title="Cancel manual payout"
        body={
          selectedCancelCashout ? (
            <>
              <p>
                Only cancel if money has not been sent. This reverses the merchant reservation.
              </p>
              <ul className="modal-detail-list">
                <li>
                  <span className="modal-detail-label">Cashout ID</span>
                  <span className="modal-detail-value mono">{selectedCancelCashout.id}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Amount to reverse</span>
                  <span className="modal-detail-value">
                    {formatNgnFromKobo(selectedCancelCashout.grossAmountKobo)}
                  </span>
                </li>
              </ul>
            </>
          ) : null
        }
        confirmLabel="Cancel manual payout"
        isBusy={isWorking}
        onConfirm={handleCancelManualPayout}
        onCancel={() => setSelectedCancelCashout(null)}
      />
    </section>
  );
}
