import { useEffect, useState } from "react";
import { getOverview, getReconciliationReport } from "../api";
import { useAuth } from "../auth";
import type { AdminOverview, ReconciliationReport } from "../types";

export function OverviewPage() {
  const { token, clearToken } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [overviewData, reportData] = await Promise.all([
          getOverview(token, clearToken),
          getReconciliationReport(token, clearToken),
        ]);

        if (!cancelled) {
          setOverview(overviewData);
          setReport(reportData);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load overview.");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [token, clearToken]);

  if (isLoading) {
    return <p>Loading overview...</p>;
  }

  if (error) {
    return <p className="error">{error}</p>;
  }

  if (!overview || !report) {
    return <p>No data available.</p>;
  }

  return (
    <section>
      <h2>Overview</h2>

      <div className="stats-grid">
        <StatCard label="Total users" value={overview.totalUsers} />
        <StatCard label="Active users" value={overview.activeUsers} />
        <StatCard label="Active students" value={overview.activeStudents} />
        <StatCard label="Active merchants" value={overview.activeMerchants} />
        <StatCard label="Pending merchants" value={overview.pendingMerchants} />
        <StatCard label="Pending cashouts" value={overview.pendingCashouts} />
        <StatCard label="Flagged users" value={overview.flaggedUsers} />
        <StatCard label="Frozen users" value={overview.frozenUsers} />
      </div>

      <h2>Reconciliation Report</h2>
      <div className="panel">
        <p>
          <strong>Invariant status:</strong>{" "}
          <span className={report.invariantPasses ? "badge ok" : "badge bad"}>
            {report.invariantPasses ? "PASS" : "FAIL"}
          </span>
        </p>
        <p>
          <strong>Sum all verified balances (kobo):</strong> {report.sumAllVerifiedBalancesKobo}
        </p>
        <p>
          <strong>Operating balance (kobo):</strong> {report.operatingBalanceKobo ?? "missing"}
        </p>
        <p>
          <strong>Operating account present:</strong> {report.operatingAccountPresent ? "yes" : "no"}
        </p>
        <p>
          <strong>Generated at:</strong> {new Date(report.generatedAt).toLocaleString()}
        </p>
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}
