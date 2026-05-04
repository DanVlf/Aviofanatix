import { Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot } from "../../lib/types";

type Props = { snapshot: TelemetrySnapshot };

export function FramesPanel({ snapshot }: Props) {
  const t = snapshot.telemetry;
  const frameCounts = Object.entries(t.frameCounts).slice(0, 8);

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Frame Activity</h3>
        <Tag minimal>{frameCounts.length} types</Tag>
      </div>
      <div className="tag-cloud">
        {frameCounts.length === 0 ? (
          <Tag minimal>No frames yet</Tag>
        ) : (
          frameCounts.map(([name, count]) => (
            <Tag key={name} large round intent="primary">
              {name} · {count}
            </Tag>
          ))
        )}
      </div>
      {t.unknownFrames.length > 0 && (
        <div className="unknown-list">
          <div className="panel-subheader">Unknown frames</div>
          {t.unknownFrames.map((frame) => (
            <div key={frame} className="unknown-item">
              {frame}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
