import { ProgressBar, Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";
import { fmt } from "../../lib/utils";

type Props = { snapshot: TelemetrySnapshot };

export function LinkPanel({ snapshot }: Props) {
  const link = snapshot.telemetry.linkStats;
  const uplinkLq = typeof link.uplinkLq === "number" ? link.uplinkLq : 0;
  const downlinkLq = typeof link.downlinkLq === "number" ? link.downlinkLq : 0;

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Link Quality</h3>
        <Tag minimal>{fmt(link.rfProfile)}</Tag>
      </div>
      <div className="progress-stack">
        <div>
          <div className="progress-label">
            <span>Uplink LQ</span>
            <strong>{fmt(link.uplinkLq, "%")}</strong>
          </div>
          <ProgressBar value={uplinkLq / 100} stripes intent="primary" />
        </div>
        <div>
          <div className="progress-label">
            <span>Downlink LQ</span>
            <strong>{fmt(link.downlinkLq, "%")}</strong>
          </div>
          <ProgressBar value={downlinkLq / 100} stripes intent="success" />
        </div>
      </div>
      <MetricGrid
        rows={[
          ["Uplink RSSI", `${fmt(link.uplinkRssi1, " dBm")} / ${fmt(link.uplinkRssi2, " dBm")}`],
          ["Downlink RSSI", fmt(link.downlinkRssi, " dBm")],
          ["Uplink SNR", fmt(link.uplinkSnr, " dB")],
          ["Downlink SNR", fmt(link.downlinkSnr, " dB")],
          ["RF power", fmt(link.rfPower)],
          ["Antenna", fmt(link.activeAntenna)],
        ]}
      />
    </div>
  );
}
