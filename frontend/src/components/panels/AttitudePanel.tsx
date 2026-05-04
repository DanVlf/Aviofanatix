import { Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";
import { fmt } from "../../lib/utils";

type Props = { snapshot: TelemetrySnapshot };

export function AttitudePanel({ snapshot }: Props) {
  const attitude = snapshot.telemetry.attitude;
  const timing = snapshot.telemetry.timing;

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Attitude</h3>
        <Tag minimal>{snapshot.telemetry.flightMode ?? "--"}</Tag>
      </div>
      <MetricGrid
        rows={[
          ["Pitch", fmt(attitude.pitchDeg, " °")],
          ["Roll", fmt(attitude.rollDeg, " °")],
          ["Yaw", fmt(attitude.yawDeg, " °")],
          ["Timing subtype", fmt(timing.subtype)],
          ["Update interval", fmt(timing.updateIntervalMs, " ms")],
          ["Offset", fmt(timing.offsetUs, " µs")],
        ]}
      />
    </div>
  );
}
