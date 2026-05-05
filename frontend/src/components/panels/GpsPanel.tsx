import { Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";
import { fmt, fmtFixed } from "../../lib/utils";

type Props = { snapshot: TelemetrySnapshot };

export function GpsPanel({ snapshot }: Props) {
  const gps = snapshot.telemetry.gps;

  return (
    <div className="panel">
      <div className="panel-header">
        <h3>GPS</h3>
        <Tag minimal>{fmt(gps.satellites)} sats</Tag>
      </div>
      <MetricGrid
        rows={[
          ["Latitude", fmtFixed(gps.latitude, 6)],
          ["Longitude", fmtFixed(gps.longitude, 6)],
          ["Ground speed", fmt(gps.groundspeedKmh, " km/h")],
          ["Vertical speed", fmt(gps.verticalSpeedMps, " m/s")],
          ["Heading", fmt(gps.headingDeg, " °")],
          ["Altitude", fmt(gps.altitudeM, " m")],
          ["Satellites", fmt(gps.satellites)],
        ]}
      />
    </div>
  );
}
