import { Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";
import { fmt } from "../../lib/utils";

type Props = {
  snapshot: TelemetrySnapshot;
};

export function SessionPanel({ snapshot }: Props) {
  const t = snapshot.telemetry;
  const stateIntent =
    snapshot.connectionState === "connected"
      ? "success"
      : snapshot.connectionState === "error"
        ? "danger"
        : "warning";

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Session</h3>
        <Tag intent={stateIntent}>{snapshot.connectionState}</Tag>
      </div>
      <MetricGrid
        rows={[
          ["Port", snapshot.port ?? "--"],
          ["Frames total", String(t.totalFrames)],
          ["Frames / sec", fmt(t.framesPerSecond)],
          ["Last frame", fmt(t.lastFrameAgoSeconds, "s")],
          ["Flight mode", t.flightMode ?? "--"],
          ["Unknown frames", String(t.unknownFrames.length)],
        ]}
      />
    </div>
  );
}
