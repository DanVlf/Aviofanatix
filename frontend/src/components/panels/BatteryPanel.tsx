import { ProgressBar, Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";
import { fmt } from "../../lib/utils";

type Props = { snapshot: TelemetrySnapshot };

export function BatteryPanel({ snapshot }: Props) {
  const battery = snapshot.telemetry.battery;
  const pct = typeof battery.remainingPct === "number" ? battery.remainingPct : 0;
  const intent = pct > 50 ? "success" : pct > 20 ? "warning" : "danger";

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>Battery</h3>
        <Tag intent={intent}>{fmt(battery.remainingPct, "%")}</Tag>
      </div>
      <ProgressBar value={pct / 100} animate={false} intent={pct > 20 ? "success" : "danger"} />
      <div style={{ marginTop: "1rem" }}>
        <MetricGrid
          rows={[
            ["Voltage", fmt(battery.voltageV, " V")],
            ["Current", fmt(battery.currentA, " A")],
            ["Capacity", fmt(battery.capacityMah, " mAh")],
            ["Remaining", fmt(battery.remainingPct, "%")],
          ]}
        />
      </div>
    </div>
  );
}
