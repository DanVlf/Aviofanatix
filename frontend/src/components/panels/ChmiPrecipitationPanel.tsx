import { useEffect, useMemo, useRef, useState } from "react";
import { Spinner, Tag } from "@blueprintjs/core";
import type { ChmiPrecipitationSnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";

type Props = {
  snapshot: ChmiPrecipitationSnapshot | null;
  loading: boolean;
};

type RadarBounds = ChmiPrecipitationSnapshot["bounds"];

type TileSpec = {
  key: string;
  src: string;
  left: number;
  top: number;
};

type LayoutSpec = {
  tiles: TileSpec[];
  overlayLeft: number;
  overlayTop: number;
  overlayWidth: number;
  overlayHeight: number;
  zoom: number;
};

const TILE_SIZE = 256;
const DEFAULT_BOUNDS: RadarBounds = {
  south: 48.047,
  west: 11.267,
  north: 52.167,
  east: 20.77,
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

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const projectWebMercator = (lat: number, lng: number, zoom: number) => {
  const limitedLat = clamp(lat, -85.05112878, 85.05112878);
  const sinLat = Math.sin((limitedLat * Math.PI) / 180);
  const worldSize = TILE_SIZE * 2 ** zoom;

  return {
    x: ((lng + 180) / 360) * worldSize,
    y: (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize,
  };
};

const getTileUrl = (zoom: number, x: number, y: number) => {
  const limit = 2 ** zoom;
  if (y < 0 || y >= limit) {
    return null;
  }

  const wrappedX = ((x % limit) + limit) % limit;
  return `https://tile.openstreetmap.org/${zoom}/${wrappedX}/${y}.png`;
};

const chooseZoom = (bounds: RadarBounds, width: number, height: number, padding: number) => {
  for (let zoom = 10; zoom >= 5; zoom -= 1) {
    const northWest = projectWebMercator(bounds.north, bounds.west, zoom);
    const southEast = projectWebMercator(bounds.south, bounds.east, zoom);
    const overlayWidth = southEast.x - northWest.x;
    const overlayHeight = southEast.y - northWest.y;

    if (overlayWidth <= width - padding * 2 && overlayHeight <= height - padding * 2) {
      return zoom;
    }
  }

  return 5;
};

function useElementSize<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }

    const update = () => {
      setSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);

    return () => observer.disconnect();
  }, []);

  return { ref, size };
}

const buildMapLayout = (bounds: RadarBounds, width: number, height: number): LayoutSpec | null => {
  if (width < 32 || height < 32) {
    return null;
  }

  const padding = 16;
  const zoom = chooseZoom(bounds, width, height, padding);
  const northWest = projectWebMercator(bounds.north, bounds.west, zoom);
  const southEast = projectWebMercator(bounds.south, bounds.east, zoom);
  const overlayWidth = southEast.x - northWest.x;
  const overlayHeight = southEast.y - northWest.y;
  const extraX = Math.max(0, width - overlayWidth);
  const extraY = Math.max(0, height - overlayHeight);
  const originX = northWest.x - extraX / 2;
  const originY = northWest.y - extraY / 2;
  const endX = originX + width;
  const endY = originY + height;

  const tileStartX = Math.floor(originX / TILE_SIZE);
  const tileEndX = Math.floor((endX - 1) / TILE_SIZE);
  const tileStartY = Math.floor(originY / TILE_SIZE);
  const tileEndY = Math.floor((endY - 1) / TILE_SIZE);

  const tiles: TileSpec[] = [];
  for (let tileY = tileStartY; tileY <= tileEndY; tileY += 1) {
    for (let tileX = tileStartX; tileX <= tileEndX; tileX += 1) {
      const src = getTileUrl(zoom, tileX, tileY);
      if (!src) {
        continue;
      }

      tiles.push({
        key: `${zoom}-${tileX}-${tileY}`,
        src,
        left: tileX * TILE_SIZE - originX,
        top: tileY * TILE_SIZE - originY,
      });
    }
  }

  return {
    tiles,
    overlayLeft: northWest.x - originX,
    overlayTop: northWest.y - originY,
    overlayWidth,
    overlayHeight,
    zoom,
  };
};

export function ChmiPrecipitationPanel({ snapshot, loading }: Props) {
  const statusIntent = snapshot?.ok ? (snapshot.stale ? "warning" : "success") : "danger";
  const statusLabel = snapshot?.ok ? (snapshot.stale ? "cached" : "live") : "offline";
  const bounds = snapshot?.bounds ?? DEFAULT_BOUNDS;
  const { ref, size } = useElementSize<HTMLDivElement>();
  const layout = useMemo(() => buildMapLayout(bounds, size.width, size.height), [bounds, size.height, size.width]);
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
    <div className="panel panel--wide precipitation-panel">
      <div className="panel-header">
        <h3>CHMI Live Radar</h3>
        <div className="panel-tags">
          <Tag intent={statusIntent}>{statusLabel}</Tag>
          <Tag minimal>CZ</Tag>
        </div>
      </div>

      {loading && snapshot === null ? (
        <div className="precip-loading">
          <Spinner size={28} />
        </div>
      ) : snapshot?.ok && imageSrc ? (
        <>
          <div className="radar-map-stage" ref={ref}>
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

                  <img
                    className="radar-map-overlay"
                    src={imageSrc}
                    alt="Looping CHMI MAX_Z radar animation over a map base"
                    style={{
                      left: `${layout.overlayLeft}px`,
                      top: `${layout.overlayTop}px`,
                      width: `${layout.overlayWidth}px`,
                      height: `${layout.overlayHeight}px`,
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
  );
}
