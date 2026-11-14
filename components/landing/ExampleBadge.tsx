type ExampleBadgeProps = {
  children?: string;
};

export function ExampleBadge({ children = "예시 데이터" }: ExampleBadgeProps) {
  return <span className="badge-example">{children}</span>;
}
