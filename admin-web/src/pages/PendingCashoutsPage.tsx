import { useCallback, useEffect, useState } from "react";
import { approveCashout, getPendingCashouts } from "../api";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/ConfirmModal";
import type { PendingCashout } from "../types";

export function PendingCashoutsPage() {
  const { token, clearToken } = useAuth();
  const [cashouts, setCashouts] = useState<PendingCashout[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [selectedCashout, setSelectedCashout] = useState<PendingCashout | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPendingCashouts = useCallback(async () => {
    if (!token) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getPendingCashouts(token, clearToken);
      setCashouts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending cashouts.");
    } finally {
      setIsLoading(false);
    }
  }, [token, clearToken]);

  useEffect(() => {
    void loadPendingCashouts();
  }, [loadPendingCashouts]);

  const handleApprove = async () => {
    if (!token || !selectedCashout) {
      return;
    }

    setIsApproving(true);
    setError(null);

    try {
      await approveCashout(selectedCashout.id, token, clearToken);
      setSelectedCashout(null);
      await loadPendingCashouts();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve cashout.");
    } finally {
      setIsApproving(false);
    }
  };

  if (isLoading) {
    return <p>Loading pending cashouts...</p>;
  }

  return (
    <section>
      <h2>Pending Cashouts</h2>
      {error ? <p className="error">{error}</p> : null}

      {cashouts.length === 0 ? (
        <p>No pending cashouts.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Merchant</th>
                <th>Amount (kobo)</th>
                <th>Requested</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {cashouts.map((cashout) => (
                <tr key={cashout.id}>
                  <td>{cashout.id}</td>
                  <td>{cashout.merchantBusinessName ?? cashout.merchantUserId}</td>
                  <td>{cashout.amountKobo}</td>
                  <td>{new Date(cashout.requestedAt).toLocaleString()}</td>
                  <td>
                    <button type="button" onClick={() => setSelectedCashout(cashout)}>
                      Approve
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={selectedCashout !== null}
        title="Approve cashout"
        body={
          <>
            Approve cashout <strong>{selectedCashout?.id}</strong> for{" "}
            <strong>{selectedCashout?.amountKobo} kobo</strong>?
          </>
        }
        confirmLabel="Approve"
        isBusy={isApproving}
        onConfirm={handleApprove}
        onCancel={() => setSelectedCashout(null)}
      />
    </section>
  );
}
