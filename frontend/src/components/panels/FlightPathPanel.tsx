import { useMemo } from "react";
import { Spinner, Tag } from "@blueprintjs/core";
import type { TelemetrySnapshot, TelemetryTrackPoint } from "../../lib/types";
import { buildMapLayout, clamp, projectPointToLayout, useElementSize, type GeoBounds } from "../../lib/map";
import { fmt, fmtFixed } from "../../lib/utils";
import { MetricGrid } from "../common/MetricGrid";

type Props = {
  snapshot: TelemetrySnapshot;
};

const MIN_LAT_SPAN = 0.01;
const MIN_LNG_SPAN = 0.01;
const BOUNDS_PADDING_RATIO = 0.18;

const buildTrackBounds = (points: TelemetryTrackPoint[]): GeoBounds | null => {
  if (points.length === 0) {
    return null;
  }

  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  let south = Math.min(...latitudes);
  let north = Math.max(...latitudes);
  let west = Math.min(...longitudes);
  let east = Math.max(...longitudes);

  const latSpan = Math.max(north - south, MIN_LAT_SPAN);
  const lngSpan = Math.max(east - west, MIN_LNG_SPAN);
  const latPad = latSpan * BOUNDS_PADDING_RATIO;
  const lngPad = lngSpan * BOUNDS_PADDING_RATIO;
  const latCenter = (south + north) / 2;
  const lngCenter = (west + east) / 2;

  south = clamp(latCenter - latSpan / 2 - latPad, -85.05112878, 85.05112878);
  north = clamp(latCenter + latSpan / 2 + latPad, -85.05112878, 85.05112878);
  west = clamp(lngCenter - lngSpan / 2 - lngPad, -180, 180);
  east = clamp(lngCenter + lngSpan / 2 + lngPad, -180, 180);

  return { south, west, north, east };
};

export function FlightPathPanel({ snapshot }: Props) {
  const gps = snapshot.telemetry.gps;
  const gpsTrack = snapshot.telemetry.gpsTrack ?? [];
  const { ref, size } = useElementSize<HTMLDivElement>();
  const liveTrack = useMemo(() => {
    if (gpsTrack.length > 0) {
      return gpsTrack;
    }

    if (typeof gps.latitude === "number" && typeof gps.longitude === "number") {
      return [
        {
          latitude: gps.latitude,
          longitude: gps.longitude,
          altitudeM: typeof gps.altitudeM === "number" ? gps.altitudeM : undefined,
        },
      ];
    }

    return [];
  }, [gps.altitudeM, gps.latitude, gps.longitude, gpsTrack]);
  const bounds = useMemo(() => buildTrackBounds(liveTrack), [liveTrack]);
  const layout = useMemo(
    () => (bounds ? buildMapLayout(bounds, size.width, size.height) : null),
    [bounds, size.height, size.width],
  );
  const projectedTrack = useMemo(() => {
    if (!layout) {
      return [];
    }

    return liveTrack.map((point) => ({
      ...projectPointToLayout(layout, point.latitude, point.longitude),
      altitudeM: point.altitudeM,
    }));
  }, [layout, liveTrack]);
  const polylinePoints = projectedTrack.map((point) => `${point.x},${point.y}`).join(" ");
  const firstPoint = projectedTrack[0] ?? null;
  const lastPoint = projectedTrack[projectedTrack.length - 1] ?? null;
  const lastTrackPoint = liveTrack[liveTrack.length - 1] ?? null;

  return (
    <div className="panel panel--wide flight-path-panel precipitation-panel--resizable">
      <div className="panel-header">
        <h3>Flight Path</h3>
        <div className="panel-tags">
          <Tag intent={snapshot.connected ? "success" : "warning"}>{snapshot.connected ? "live" : "waiting"}</Tag>
          <Tag minimal>{liveTrack.length} pts</Tag>
        </div>
      </div>

      <div className="flight-path-body">
        {liveTrack.length === 0 ? (
          <div className="precip-empty">
            <div className="precip-empty-title">Flight path unavailable</div>
            <div className="precip-empty-copy">
              Waiting for the first valid GPS fix to start drawing the route.
            </div>
          </div>
        ) : (
          <>
            <div className="radar-map-stage flight-path-stage" ref={ref}>
              {layout ? (
                <>
                  <div className="radar-map-canvas">
                    {layout.tiles.map((tile) => (
                      <img
                        key={tile.key}
                        className="radar-map-tile"
                        src={tile.src}
                        alt=""
                        aria-hidden="true"
                        style={{ left: `${tile.left}px`, top: `${tile.top}px` }}
                      />
                    ))}

                    <svg
                      className="flight-path-overlay"
                      viewBox={`0 0 ${layout.width} ${layout.height}`}
                      role="img"
                      aria-label="Drone flight path over OpenStreetMap"
                    >
                      {polylinePoints ? (
                        <polyline className="flight-path-line" points={polylinePoints} />
                      ) : null}
                      {firstPoint ? (
                        <circle className="flight-path-marker flight-path-marker--start" cx={firstPoint.x} cy={firstPoint.y} r="6" />
                      ) : null}
                      {lastPoint ? (
                        <circle className="flight-path-marker flight-path-marker--end" cx={lastPoint.x} cy={lastPoint.y} r="7" />
                      ) : null}
                    </svg>
                  </div>

                  <div className="radar-map-attribution">
                    map ©{" "}
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                      OpenStreetMap
                    </a>
                  </div>
                  <div className="radar-map-zoom">z{layout.zoom}</div>
                  <div className="flight-path-chip">
                    {liveTrack.length === 1 ? "single fix" : "route"}
                  </div>
                </>
              ) : (
                <div className="radar-map-loading">
                  <Spinner size={24} />
                </div>
              )}
            </div>

            <MetricGrid
              rows={[
                ["Track points", String(liveTrack.length)],
                ["Latest fix", lastTrackPoint
                  ? `${fmtFixed(lastTrackPoint.latitude, 6)}, ${fmtFixed(lastTrackPoint.longitude, 6)}`
                  : "--"],
                ["Ground speed", fmt(gps.groundspeedKmh, " km/h")],
                ["Vertical speed", fmt(gps.verticalSpeedMps, " m/s")],
                ["Altitude", fmt(gps.altitudeM, " m")],
              ]}
            />
          </>
        )}
      </div>
    </div>
  );
}
