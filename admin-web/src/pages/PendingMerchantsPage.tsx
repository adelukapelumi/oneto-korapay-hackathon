import { useCallback, useEffect, useState } from "react";
import { approveMerchant, getPendingMerchants } from "../api";
import { useAuth } from "../auth";
import { ConfirmModal } from "../components/ConfirmModal";
import type { PendingMerchant } from "../types";

export function PendingMerchantsPage() {
  const { token, clearToken } = useAuth();
  const [merchants, setMerchants] = useState<PendingMerchant[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isApproving, setIsApproving] = useState(false);
  const [selectedMerchant, setSelectedMerchant] = useState<PendingMerchant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadPendingMerchants = useCallback(async () => {
    if (!token) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await getPendingMerchants(token, clearToken);
      setMerchants(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pending merchants.");
    } finally {
      setIsLoading(false);
    }
  }, [token, clearToken]);

  useEffect(() => {
    void loadPendingMerchants();
  }, [loadPendingMerchants]);

  const handleApprove = async () => {
    if (!token || !selectedMerchant) {
      return;
    }

    setIsApproving(true);
    setError(null);

    try {
      await approveMerchant(selectedMerchant.userId, token, clearToken);
      setSelectedMerchant(null);
      await loadPendingMerchants();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to approve merchant.");
    } finally {
      setIsApproving(false);
    }
  };

  if (isLoading) {
    return <p>Loading pending merchants...</p>;
  }

  return (
    <section>
      <h2>Pending Merchants</h2>
      {error ? <p className="error">{error}</p> : null}

      {merchants.length === 0 ? (
        <p>No pending merchants.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>User ID</th>
                <th>Email</th>
                <th>Business</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {merchants.map((merchant) => (
                <tr key={merchant.userId}>
                  <td>{merchant.userId}</td>
                  <td>{merchant.email}</td>
                  <td>{merchant.businessName ?? "-"}</td>
                  <td>{new Date(merchant.createdAt).toLocaleString()}</td>
                  <td>
                    <button type="button" onClick={() => setSelectedMerchant(merchant)}>
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
        open={selectedMerchant !== null}
        title="Approve merchant"
        body={
          <>
            Approve merchant <strong>{selectedMerchant?.businessName ?? selectedMerchant?.email}</strong>?
          </>
        }
        confirmLabel="Approve"
        isBusy={isApproving}
        onConfirm={handleApprove}
        onCancel={() => setSelectedMerchant(null)}
      />
    </section>
  );
}
