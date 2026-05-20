type MetricCardTone = "neutral" | "attention" | "danger";

type MetricCardProps = {
  label: string;
  value: string;
  tone?: MetricCardTone;
  hint?: string;
};

export function MetricCard({
  label,
  value,
  tone = "neutral",
  hint,
}: MetricCardProps) {
  return (
    <div className={`metric-card metric-card-${tone}`}>
      <div className="metric-card-header">
        <span className="metric-label">{label}</span>
      </div>
      <div className="metric-value">{value}</div>
      {hint ? <p className="metric-hint">{hint}</p> : null}
    </div>
  );
}
