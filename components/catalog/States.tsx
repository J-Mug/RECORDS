export function LoadingState({ label = "불러오는 중…" }: { label?: string }) {
  return (
    <div className="state-box" role="status">
      {label}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <div className="state-box">
      <p className="state-title">{title}</p>
      {body ? <p className="state-body">{body}</p> : null}
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="state-box state-error" role="alert">
      <p className="state-title">불러오지 못했습니다.</p>
      <p className="state-body">{message}</p>
    </div>
  );
}
