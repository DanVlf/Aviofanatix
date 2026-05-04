import { Spinner, Tag } from "@blueprintjs/core";
import type { ChmiPrecipitationSnapshot } from "../../lib/types";
import { MetricGrid } from "../common/MetricGrid";

type Props = {
  snapshot: ChmiPrecipitationSnapshot | null;
  loading: boolean;
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
  const imageVersion = snapshot?.checkedAtUtc ?? snapshot?.frameTimeUtc ?? "";
  const imageSrc = snapshot?.imageUrl ? `${snapshot.imageUrl}?v=${encodeURIComponent(imageVersion)}` : null;

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
          <div className="radar-single-wrap">
            <img className="radar-single-image" src={imageSrc} alt="Latest CHMI radar image over the Czech Republic" />
          </div>

          <MetricGrid
            rows={[
              ["Frame", formatDateTime(snapshot.frameTimeLocal)],
              ["Age", snapshot.ageMinutes == null ? "--" : `${snapshot.ageMinutes} min`],
              ["Product", snapshot.product],
              ["Checked", formatDateTime(snapshot.checkedAtUtc)],
            ]}
          />

          <div className="precip-footer">
            <a className="precip-link" href={snapshot.sourceUrl} target="_blank" rel="noreferrer">
              Open CHMI radar source
            </a>
            <span className="precip-note">Radar frames are published by CHMI every 5 minutes.</span>
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
