import { useEffect, useState } from "react";
import { getOverview, getReconciliationReport } from "../api";
import { useAuth } from "../auth";
import { MetricCard } from "../components/MetricCard";
import type { AdminOverview, ReconciliationReport } from "../types";

const countFormatter = new Intl.NumberFormat("en-NG");

function formatCount(value: number) {
  return countFormatter.format(value);
}

function formatKoboValue(value: string | null) {
  if (value === null) {
    return "missing";
  }

  try {
    return countFormatter.format(BigInt(value));
  } catch {
    return value;
  }
}

export function OverviewPage() {
  const { markAnonymous } = useAuth();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [report, setReport] = useState<ReconciliationReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const [overviewData, reportData] = await Promise.all([
          getOverview(markAnonymous),
          getReconciliationReport(markAnonymous),
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
  }, [markAnonymous]);

  if (isLoading) {
    return (
      <section className="page-section">
        <div className="panel">
          <p className="supporting-text">Loading overview...</p>
        </div>
      </section>
    );
  }

  if (error) {
    return (
      <section className="page-section">
        <p className="error">{error}</p>
      </section>
    );
  }

  if (!overview || !report) {
    return (
      <section className="page-section">
        <div className="panel">
          <p className="supporting-text">No data available.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page-section">
      <div className="page-header">
        <div className="page-header-copy">
          <p className="page-eyebrow">Operations dashboard</p>
          <h1 className="page-title">Overview</h1>
          <p className="page-description">
            Review live admin counts and confirm the reconciliation invariant before approving
            merchant cashouts.
          </p>
        </div>
        <div className="page-meta">
          <span className="status-pill">Live data</span>
        </div>
      </div>

      <div className="stats-grid">
        <MetricCard label="Total Users" value={formatCount(overview.totalUsers)} />
        <MetricCard label="Active Users" value={formatCount(overview.activeUsers)} />
        <MetricCard label="Active Students" value={formatCount(overview.activeStudents)} />
        <MetricCard label="Active Merchants" value={formatCount(overview.activeMerchants)} />
        <MetricCard
          label="Pending Merchants"
          value={formatCount(overview.pendingMerchants)}
          tone={overview.pendingMerchants > 0 ? "attention" : "neutral"}
          hint="Awaiting admin approval"
        />
        <MetricCard
          label="Pending Cashouts"
          value={formatCount(overview.pendingCashouts)}
          tone={overview.pendingCashouts > 0 ? "attention" : "neutral"}
          hint="Review only after invariant check"
        />
        <MetricCard
          label="Flagged Users"
          value={formatCount(overview.flaggedUsers)}
          tone={overview.flaggedUsers > 0 ? "danger" : "neutral"}
        />
        <MetricCard
          label="Frozen Users"
          value={formatCount(overview.frozenUsers)}
          tone={overview.frozenUsers > 0 ? "danger" : "neutral"}
        />
      </div>

      <div className="risk-panel">
        <div className="risk-panel-header">
          <div className="risk-panel-copy">
            <p className="page-eyebrow">Reconciliation report</p>
            <h3>Float invariant check</h3>
            <p className="page-description">
              Expected state: sum of all verified balances plus the operating balance should equal
              zero.
            </p>
          </div>
          <span
            className={
              report.invariantPasses ? "risk-badge risk-badge-pass" : "risk-badge risk-badge-fail"
            }
          >
            {report.invariantPasses ? "Invariant Pass" : "Invariant Fail"}
          </span>
        </div>

        <div
          className={
            report.invariantPasses ? "risk-alert risk-alert-ok" : "risk-alert risk-alert-danger"
          }
        >
          {report.invariantPasses
            ? "Balances are consistent with the operating account based on the latest report."
            : "Do not approve cashouts until reviewed."}
        </div>

        <div className="risk-grid">
          <div className="risk-item">
            <span className="risk-item-label">Sum Of All Verified Balances (kobo)</span>
            <div className="risk-item-value">{formatKoboValue(report.sumAllVerifiedBalancesKobo)}</div>
          </div>

          <div className="risk-item">
            <span className="risk-item-label">Operating Balance (kobo)</span>
            <div className="risk-item-value">{formatKoboValue(report.operatingBalanceKobo)}</div>
          </div>

          <div className="risk-item">
            <span className="risk-item-label">Operating Account Present</span>
            <div className="risk-item-value">{report.operatingAccountPresent ? "Yes" : "No"}</div>
          </div>

          <div className="risk-item">
            <span className="risk-item-label">Generated At</span>
            <div className="risk-item-value">{new Date(report.generatedAt).toLocaleString()}</div>
          </div>
        </div>

        {!report.operatingAccountPresent ? (
          <p className="error">
            The operating account is missing from this report. Cashout review should pause until the
            account state is confirmed.
          </p>
        ) : null}
      </div>
    </section>
  );
}
