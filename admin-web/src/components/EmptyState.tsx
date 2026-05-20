type EmptyStateProps = {
  title: string;
  description: string;
};

export function EmptyState({ title, description }: EmptyStateProps) {
  return (
    <div className="empty-state panel">
      <span className="empty-state-icon" aria-hidden="true">
        O
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
