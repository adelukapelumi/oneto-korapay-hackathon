import { useCallback, useEffect, useState } from "react";
import {
  approveRecoveryRequest,
  getPendingRecoveryRequests,
  rejectRecoveryRequest,
} from "../api";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/ConfirmModal";
import { EmptyState } from "../components/EmptyState";
import type { PendingRecoveryRequest } from "../types";

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

function formatKeySuffix(publicKey: string) {
  return publicKey.slice(-8);
}

function isHighRiskRequest(request: PendingRecoveryRequest) {
  return request.reason === "STOLEN_PHONE" || request.riskType === "COMPROMISED_DEVICE";
}

type RecoveryAction = {
  mode: "approve" | "reject";
  request: PendingRecoveryRequest;
};

export function RecoveryRequestsPage() {
  const { markAnonymous } = useAuth();
  const [requests, setRequests] = useState<PendingRecoveryRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedAction, setSelectedAction] = useState<RecoveryAction | null>(null);
  const [decisionNotes, setDecisionNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const loadPendingRequests = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await getPendingRecoveryRequests(markAnonymous);
      setRequests(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending recovery requests.");
    } finally {
      setIsLoading(false);
    }
  }, [markAnonymous]);

  useEffect(() => {
    void loadPendingRequests();
  }, [loadPendingRequests]);

  const openActionModal = (mode: RecoveryAction["mode"], request: PendingRecoveryRequest) => {
    setDecisionNotes("");
    setError(null);
    setSelectedAction({ mode, request });
  };

  const closeActionModal = () => {
    if (isSubmitting) {
      return;
    }

    setSelectedAction(null);
    setDecisionNotes("");
  };

  const handleSubmit = async () => {
    if (!selectedAction) {
      return;
    }

    const trimmedDecisionNotes = decisionNotes.trim();
    if (selectedAction.mode === "reject" && trimmedDecisionNotes.length === 0) {
      setError("Decision notes are required to reject a recovery request.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      if (selectedAction.mode === "approve") {
        await approveRecoveryRequest(
          selectedAction.request.id,
          {
            decisionNotes: trimmedDecisionNotes || undefined,
          },
          markAnonymous,
        );
      } else {
        await rejectRecoveryRequest(
          selectedAction.request.id,
          {
            decisionNotes: trimmedDecisionNotes,
          },
          markAnonymous,
        );
      }

      setSelectedAction(null);
      setDecisionNotes("");
      await loadPendingRequests();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : `Failed to ${selectedAction.mode} recovery request.`,
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <section className="page-section">
        <div className="panel">
          <p className="supporting-text">Loading recovery requests...</p>
        </div>
      </section>
    );
  }

  if (error && requests.length === 0) {
    return (
      <section className="page-section">
        <div className="panel">
          <div className="page-header">
            <div className="page-header-copy">
              <p className="page-eyebrow">Recovery review</p>
              <h1 className="page-title">Recovery Requests</h1>
              <p className="page-description">
                Review pending account recovery requests before approving key replacement.
              </p>
            </div>
          </div>
          <p className="error">{error}</p>
          <div className="stack-actions">
            <button type="button" onClick={() => void loadPendingRequests()}>
              Retry
            </button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="page-header-copy">
          <p className="page-eyebrow">Recovery review</p>
          <h1 className="page-title">Recovery Requests</h1>
          <p className="page-description">
            Review pending account recovery requests before approving key replacement.
          </p>
        </div>
        <div className="page-meta">
          <span className="status-pill">
            {requests.length} {requests.length === 1 ? "request" : "requests"}
          </span>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      {requests.length === 0 ? (
        <EmptyState
          title="No pending recovery requests."
          description="Recovery requests that still need admin review will appear here."
        />
      ) : (
        <div className="panel table-card">
          <div className="table-card-header">
            <div>
              <h2 className="table-title">Pending review queue</h2>
              <p className="table-note">
                Show caution on high-risk cases. Approvals rotate the user onto a new device key and
                may create a recovery balance hold.
              </p>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Recovery context</th>
                  <th>Key details</th>
                  <th>Submitted</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map((request) => (
                  <tr key={request.id}>
                    <td>
                      <div className="table-primary">
                        <span>{request.user.email}</span>
                        <span className="table-secondary">
                          {request.user.role} / {request.user.status}
                        </span>
                        <span className="table-secondary">
                          Verified balance: {formatNgnFromKobo(request.user.verifiedBalanceKobo)}
                        </span>
                        <span className="table-secondary mono">Request {request.id}</span>
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span>
                          {request.reason} / {request.riskType}
                        </span>
                        <span className="table-secondary">
                          User notes: {request.userNotes ?? "Not provided"}
                        </span>
                        <span className="table-secondary">
                          Approximate balance:{" "}
                          {formatOptionalNgnFromKobo(
                            request.approximateBalanceKobo,
                            "Not provided",
                          )}
                        </span>
                        <span className="table-secondary">
                          Last merchant text: {request.lastMerchantText ?? "Not provided"}
                        </span>
                        <span className="table-secondary">
                          Last top-up amount:{" "}
                          {formatOptionalNgnFromKobo(
                            request.lastTopupAmountKobo,
                            "Not provided",
                          )}
                        </span>
                        {isHighRiskRequest(request) ? (
                          <span className="error">
                            High-risk recovery. The old device may already be restricted. Approve
                            only after support verification.
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div className="table-primary">
                        <span>Old key suffix: {formatKeySuffix(request.oldKey.publicKey)}</span>
                        <span>
                          New key suffix: {formatKeySuffix(request.requestedNewPublicKey)}
                        </span>
                        <span className="table-secondary">
                          Old key status: {request.oldKey.status}
                        </span>
                        <span className="table-secondary">
                          Retired at:{" "}
                          {request.oldKey.retiredAt
                            ? new Date(request.oldKey.retiredAt).toLocaleString()
                            : "Not set"}
                        </span>
                        <span className="table-secondary">
                          Verify until:{" "}
                          {request.oldKey.verifyUntil
                            ? new Date(request.oldKey.verifyUntil).toLocaleString()
                            : "Not set"}
                        </span>
                      </div>
                    </td>
                    <td>{new Date(request.createdAt).toLocaleString()}</td>
                    <td className="table-action">
                      <div className="table-actions">
                        <button
                          type="button"
                          onClick={() => openActionModal("approve", request)}
                          disabled={isSubmitting}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="secondary danger"
                          onClick={() => openActionModal("reject", request)}
                          disabled={isSubmitting}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmModal
        open={selectedAction !== null}
        title={
          selectedAction?.mode === "reject"
            ? "Reject recovery request"
            : "Approve recovery request"
        }
        body={
          selectedAction ? (
            <>
              {selectedAction.mode === "reject" ? (
                <p>Rejecting a recovery request requires decision notes for the audit trail.</p>
              ) : (
                <p>
                  Approval trusts the new device key, updates the user key reference, and may create
                  a recovery balance hold.
                </p>
              )}
              {isHighRiskRequest(selectedAction.request) ? (
                <p className="error">
                  High-risk recovery. The old device may already be restricted. Approve only after
                  support verification.
                </p>
              ) : null}
              <ul className="modal-detail-list">
                <li>
                  <span className="modal-detail-label">User</span>
                  <span className="modal-detail-value">{selectedAction.request.user.email}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Reason</span>
                  <span className="modal-detail-value">{selectedAction.request.reason}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Risk type</span>
                  <span className="modal-detail-value">{selectedAction.request.riskType}</span>
                </li>
                <li>
                  <span className="modal-detail-label">Old key suffix</span>
                  <span className="modal-detail-value mono">
                    {formatKeySuffix(selectedAction.request.oldKey.publicKey)}
                  </span>
                </li>
                <li>
                  <span className="modal-detail-label">New key suffix</span>
                  <span className="modal-detail-value mono">
                    {formatKeySuffix(selectedAction.request.requestedNewPublicKey)}
                  </span>
                </li>
              </ul>
              <div className="field-group">
                <label htmlFor="recoveryDecisionNotes">
                  Decision notes
                  {selectedAction.mode === "reject" ? " (required)" : " (optional)"}
                </label>
                <textarea
                  id="recoveryDecisionNotes"
                  rows={4}
                  value={decisionNotes}
                  onChange={(event) => setDecisionNotes(event.target.value)}
                  placeholder={
                    selectedAction.mode === "reject"
                      ? "Explain why this request is being rejected"
                      : "Optional support verification or operator note"
                  }
                />
              </div>
            </>
          ) : null
        }
        confirmLabel={selectedAction?.mode === "reject" ? "Reject request" : "Approve request"}
        isBusy={isSubmitting}
        onConfirm={handleSubmit}
        onCancel={closeActionModal}
      />
    </section>
  );
}
