import type { ReactNode } from "react";

type Props = {
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyTitle: string;
  emptyHint: string;
  onRetry?: () => void;
  children: ReactNode;
};

/** The four states from App Flow 3.5: loading, empty, error, populated. */
export default function StateView({ loading, error, isEmpty, emptyTitle, emptyHint, onRetry, children }: Props) {
  if (loading) {
    return (
      <div className="mv-skel-stack" aria-busy="true" aria-label="Loading">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="mv-skel" />
        ))}
      </div>
    );
  }
  if (error) {
    return (
      <div className="mv-state" role="alert">
        <strong>We couldn't load this view</strong>
        <p>{error}</p>
        {onRetry && (
          <button className="mv-btn" onClick={onRetry}>
            Try again
          </button>
        )}
      </div>
    );
  }
  if (isEmpty) {
    return (
      <div className="mv-state">
        <strong>{emptyTitle}</strong>
        <p>{emptyHint}</p>
      </div>
    );
  }
  return <>{children}</>;
}
