type Props = {
  rows: Array<[string, string]>;
};

export function MetricGrid({ rows }: Props) {
  return (
    <div className="metric-grid">
      {rows.map(([label, value]) => (
        <div className="metric-row" key={label}>
          <span className="metric-label">{label}</span>
          <span className="metric-value">{value}</span>
        </div>
      ))}
    </div>
  );
}
