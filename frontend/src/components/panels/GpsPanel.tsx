import { Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";
import { fmt } from "../../lib/utils";

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
          ["Latitude", fmt(gps.latitude)],
          ["Longitude", fmt(gps.longitude)],
          ["Speed", fmt(gps.groundspeedKmh, " km/h")],
          ["Heading", fmt(gps.headingDeg, " °")],
          ["Altitude", fmt(gps.altitudeM, " m")],
          ["Satellites", fmt(gps.satellites)],
        ]}
      />
    </div>
  );
}
