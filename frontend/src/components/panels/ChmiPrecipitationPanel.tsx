import { useEffect, useMemo, useState } from "react";
import { Spinner, Tag } from "@blueprintjs/core";
import type { ChmiPrecipitationSnapshot } from "../../lib/types";
import { buildMapLayout, projectPointToLayout, useElementSize, type GeoBounds } from "../../lib/map";
import { MetricGrid } from "../common/MetricGrid";

type Props = {
  snapshot: ChmiPrecipitationSnapshot | null;
  loading: boolean;
};

const DEFAULT_BOUNDS: ChmiPrecipitationSnapshot["bounds"] = {
  south: 48.047,
  west: 11.267,
  north: 52.167,
  east: 20.77,
};
const CZECH_FOCUS_BOUNDS: GeoBounds = {
  south: 48.35,
  west: 11.7,
  north: 51.2,
  east: 19.2,
};

const formatDateTime = (value: string | null) => {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export function ChmiPrecipitationPanel({ snapshot, loading }: Props) {
  const statusIntent = snapshot?.ok ? (snapshot.stale ? "warning" : "success") : "danger";
  const statusLabel = snapshot?.ok ? (snapshot.stale ? "cached" : "live") : "offline";
  const overlayBounds = snapshot?.bounds ?? DEFAULT_BOUNDS;
  const { ref, size } = useElementSize<HTMLDivElement>();
  const layout = useMemo(() => buildMapLayout(CZECH_FOCUS_BOUNDS, size.width, size.height), [size.height, size.width]);
  const overlayLayout = useMemo(() => {
    if (!layout) {
      return null;
    }

    const northWest = projectPointToLayout(layout, overlayBounds.north, overlayBounds.west);
    const southEast = projectPointToLayout(layout, overlayBounds.south, overlayBounds.east);
    return {
      left: northWest.x,
      top: northWest.y,
      width: southEast.x - northWest.x,
      height: southEast.y - northWest.y,
    };
  }, [layout, overlayBounds]);
  const animationFrames = useMemo(() => {
    const frames = snapshot?.frames ?? [];
    return [...frames].reverse();
  }, [snapshot?.frames]);
  const frameKey = animationFrames.map((frame) => frame.filename).join("|");
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
  }, [frameKey]);

  useEffect(() => {
    if (animationFrames.length < 2) {
      return;
    }

    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % animationFrames.length);
    }, 650);

    return () => window.clearInterval(intervalId);
  }, [animationFrames.length, frameKey]);

  const activeFrame = animationFrames[frameIndex] ?? null;
  const imageVersion = snapshot?.checkedAtUtc ?? snapshot?.frameTimeUtc ?? "";
  const imageSrc = activeFrame?.imageUrl
    ? `${activeFrame.imageUrl}?v=${encodeURIComponent(imageVersion)}`
    : snapshot?.imageUrl
      ? `${snapshot.imageUrl}?v=${encodeURIComponent(imageVersion)}`
      : null;

  return (
    <div className="panel panel--wide precipitation-panel precipitation-panel--resizable">
      <div className="panel-header">
        <h3>CHMI Live Radar</h3>
        <div className="panel-tags">
          <Tag intent={statusIntent}>{statusLabel}</Tag>
          <Tag minimal>CZ</Tag>
        </div>
      </div>

      <div className="precipitation-panel-body">
        {loading && snapshot === null ? (
          <div className="precip-loading">
            <Spinner size={28} />
          </div>
        ) : snapshot?.ok && imageSrc ? (
          <>
            <div className="radar-map-stage" ref={ref}>
              {layout && overlayLayout ? (
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

                    <img
                      className="radar-map-overlay"
                      src={imageSrc}
                      alt="Looping CHMI MAX_Z radar animation over a map base"
                      style={{
                        left: `${overlayLayout.left}px`,
                        top: `${overlayLayout.top}px`,
                        width: `${overlayLayout.width}px`,
                        height: `${overlayLayout.height}px`,
                      }}
                    />
                  </div>

                  <div className="radar-map-attribution">
                    map ©{" "}
                    <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                      OpenStreetMap
                    </a>
                  </div>
                  <div className="radar-map-zoom">z{layout.zoom}</div>
                  {animationFrames.length > 1 ? (
                    <div className="radar-map-loop">
                      {frameIndex + 1}/{animationFrames.length}
                    </div>
                  ) : null}
                  <div className="radar-frame-preload-strip" aria-hidden="true">
                    {animationFrames.map((frame) => (
                      <img key={frame.filename} src={frame.imageUrl ?? undefined} alt="" />
                    ))}
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
                ["Frame", formatDateTime(activeFrame?.frameTimeLocal ?? snapshot.frameTimeLocal)],
                ["Age", activeFrame?.ageMinutes == null ? (snapshot.ageMinutes == null ? "--" : `${snapshot.ageMinutes} min`) : `${activeFrame.ageMinutes} min`],
                ["Loop", animationFrames.length > 1 ? `${frameIndex + 1} / ${animationFrames.length}` : "1 / 1"],
                ["Product", snapshot.product],
                ["Checked", formatDateTime(snapshot.checkedAtUtc)],
              ]}
            />

            <div className="precip-footer">
              <a className="precip-link" href={snapshot.sourceUrl} target="_blank" rel="noreferrer">
                Open CHMI radar source
              </a>
              <span className="precip-note">Looping the latest {Math.max(animationFrames.length, 1)} MAX_Z frames from CHMI.</span>
            </div>
          </>
        ) : (
          <div className="precip-empty">
            <div className="precip-empty-title">Live radar unavailable</div>
            <div className="precip-empty-copy">
              {snapshot?.error ?? "CHMI radar data has not loaded yet."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
