import { useEffect, useMemo, useState } from "react";
import { Button, ButtonGroup, Spinner, Tag } from "@blueprintjs/core";
import type { RecordingEntry, RecordingStatus, RecordingSummary, TelemetrySnapshot } from "../../lib/types";
import { API_BASE, fmt, fmtFixed } from "../../lib/utils";

type Props = {
  liveSnapshot: TelemetrySnapshot | null;
};

type RecordingTab = "library" | "playback";

type SeriesDefinition = {
  key: string;
  label: string;
  color: string;
  unit: string;
};

type ChartRow = {
  t: number;
  [key: string]: number | null;
};

const CHART_SERIES: Record<string, SeriesDefinition[]> = {
  link: [
    { key: "linkStats.uplinkRssi1", label: "RSSI Ant1", color: "#0e6b86", unit: "dBm" },
    { key: "linkStats.uplinkRssi2", label: "RSSI Ant2", color: "#2f8da8", unit: "dBm" },
    { key: "linkStats.downlinkRssi", label: "Downlink RSSI", color: "#d97706", unit: "dBm" },
    { key: "linkStats.uplinkLq", label: "Uplink LQ", color: "#0f766e", unit: "%" },
    { key: "linkStats.downlinkLq", label: "Downlink LQ", color: "#16a34a", unit: "%" },
  ],
  battery: [
    { key: "battery.voltageV", label: "Voltage", color: "#d97706", unit: "V" },
    { key: "battery.currentA", label: "Current", color: "#b45309", unit: "A" },
    { key: "battery.capacityMah", label: "Used mAh", color: "#b91c1c", unit: "mAh" },
    { key: "battery.remainingPct", label: "Remaining", color: "#0f766e", unit: "%" },
  ],
  gps: [
    { key: "gps.altitudeM", label: "Altitude", color: "#0e6b86", unit: "m" },
    { key: "gps.groundspeedKmh", label: "Ground speed", color: "#16a34a", unit: "km/h" },
    { key: "gps.verticalSpeedMps", label: "Vertical speed", color: "#d97706", unit: "m/s" },
    { key: "gps.satellites", label: "Satellites", color: "#7c3aed", unit: "" },
  ],
  attitude: [
    { key: "attitude.pitchDeg", label: "Pitch", color: "#0e6b86", unit: "°" },
    { key: "attitude.rollDeg", label: "Roll", color: "#d97706", unit: "°" },
    { key: "attitude.yawDeg", label: "Yaw", color: "#7c3aed", unit: "°" },
  ],
};

const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2, 4];

const EMPTY_RECORDING_STATUS: RecordingStatus = {
  recording: false,
  filename: null,
  startedAtUtc: null,
  elapsedSeconds: null,
  frameCount: 0,
};

const getNestedValue = (value: unknown, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, key) => {
    if (typeof current !== "object" || current === null || !(key in current)) {
      return null;
    }
    return (current as Record<string, unknown>)[key];
  }, value);
};

const formatDateTime = (value: string | null) => {
  if (!value) {
    return "--";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("cs-CZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
};

const formatSize = (value: number) => {
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KB`;
  }
  return `${value} B`;
};

const buildChartData = (frames: RecordingEntry[]): ChartRow[] => {
  return frames.map((frame) => {
    const telemetry = frame.snap?.telemetry ?? null;
    const row: ChartRow = { t: Number(frame.elapsed.toFixed(3)) };
    for (const series of Object.values(CHART_SERIES).flat()) {
      const nested = getNestedValue(telemetry, series.key);
      row[series.key] = typeof nested === "number" ? Number(nested.toFixed(3)) : null;
    }
    return row;
  });
};

function TelemetryChart({
  title,
  series,
  data,
  playheadIdx,
}: {
  title: string;
  series: SeriesDefinition[];
  data: ChartRow[];
  playheadIdx: number;
}) {
  const [activeSeries, setActiveSeries] = useState<Set<string>>(() => new Set(series.map((item) => item.key)));
  const viewWidth = 1000;
  const viewHeight = 260;
  const padLeft = 60;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 30;
  const plotWidth = viewWidth - padLeft - padRight;
  const plotHeight = viewHeight - padTop - padBottom;

  const visibleSeries = series.filter((item) => activeSeries.has(item.key));
  const allValues = visibleSeries.flatMap((item) =>
    data
      .map((row) => row[item.key])
      .filter((value): value is number => typeof value === "number"),
  );
  const minValue = allValues.length > 0 ? Math.min(...allValues) : 0;
  const maxValue = allValues.length > 0 ? Math.max(...allValues) : 1;
  const rangePadding = minValue === maxValue ? 1 : (maxValue - minValue) * 0.08;
  const domainMin = minValue - rangePadding;
  const domainMax = maxValue + rangePadding;
  const elapsedMax = data.length > 0 ? data[data.length - 1].t : 1;
  const playheadTime = data[playheadIdx]?.t ?? null;

  const xFor = (timeValue: number) => {
    if (elapsedMax <= 0) {
      return padLeft;
    }
    return padLeft + (timeValue / elapsedMax) * plotWidth;
  };

  const yFor = (metricValue: number) => {
    if (domainMax === domainMin) {
      return padTop + plotHeight / 2;
    }
    const ratio = (metricValue - domainMin) / (domainMax - domainMin);
    return padTop + plotHeight - ratio * plotHeight;
  };

  const toggleSeries = (key: string) => {
    setActiveSeries((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  return (
    <div className="recording-chart-panel" style={{ marginBottom: "2rem" }}>
      <div className="recording-chart-head" style={{ marginBottom: "1rem" }}>
        <h4 style={{ margin: 0 }}>{title}</h4>
        <div className="recording-chart-legend" style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
          {series.map((item) => (
            <button
              key={item.key}
              type="button"
              style={{
                background: "none",
                border: "none",
                display: "flex",
                alignItems: "center",
                gap: "0.5rem",
                cursor: "pointer",
                opacity: activeSeries.has(item.key) ? 1 : 0.4,
                fontSize: "0.85rem",
              }}
              onClick={() => toggleSeries(item.key)}
            >
              <span style={{ display: "inline-block", width: "12px", height: "12px", borderRadius: "2px", background: item.color }} />
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div className="recording-chart-empty">No playback data loaded yet.</div>
      ) : (
        <div className="recording-chart-shell" style={{ border: "1px solid rgba(128, 128, 128, 0.2)", borderRadius: "4px", padding: "0.5rem", background: "rgba(0,0,0,0.02)" }}>
          <svg className="recording-chart-svg" viewBox={`0 0 ${viewWidth} ${viewHeight}`} style={{ width: "100%", height: "auto", display: "block" }}>
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padTop + plotHeight - (plotHeight * ratio);
              const val = domainMin + (domainMax - domainMin) * ratio;
              return (
                <g key={`y-${ratio}`}>
                  <line
                    x1={padLeft}
                    y1={y}
                    x2={padLeft + plotWidth}
                    y2={y}
                    stroke="rgba(128, 128, 128, 0.3)"
                    strokeDasharray="4 4"
                  />
                  <text x={padLeft - 8} y={y + 4} textAnchor="end" fontSize="11" fill="rgba(128, 128, 128, 0.8)" fontFamily="sans-serif">
                    {fmtFixed(val, 1)}
                  </text>
                </g>
              );
            })}

            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const x = padLeft + plotWidth * ratio;
              const val = elapsedMax * ratio;
              return (
                <g key={`x-${ratio}`}>
                  <line
                    x1={x}
                    y1={padTop + plotHeight}
                    x2={x}
                    y2={padTop + plotHeight + 5}
                    stroke="rgba(128, 128, 128, 0.5)"
                  />
                  <text x={x} y={padTop + plotHeight + 20} textAnchor="middle" fontSize="11" fill="rgba(128, 128, 128, 0.8)" fontFamily="sans-serif">
                    {fmtFixed(val, 1)}s
                  </text>
                </g>
              );
            })}

            {playheadTime !== null ? (
              <line
                x1={xFor(playheadTime)}
                y1={padTop}
                x2={xFor(playheadTime)}
                y2={padTop + plotHeight}
                stroke="rgba(255, 0, 0, 0.5)"
                strokeWidth="2"
              />
            ) : null}

            {visibleSeries.map((item) => {
              const points = data
                .map((row) => {
                  const metricValue = row[item.key];
                  if (typeof metricValue !== "number") {
                    return null;
                  }
                  return `${xFor(row.t)},${yFor(metricValue)}`;
                })
                .filter((point): point is string => point !== null)
                .join(" ");

              if (points.length === 0) {
                return null;
              }

              return (
                <polyline
                  key={item.key}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  points={points}
                />
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
}

function RecordingItem({
  recording,
  selected,
  onLoad,
  onExport,
  onDelete,
}: {
  recording: RecordingSummary;
  selected: boolean;
  onLoad: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  return (
    <div className={`recording-item${selected ? " is-selected" : ""}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "1rem", borderBottom: "1px solid rgba(128, 128, 128, 0.2)", background: selected ? "rgba(0,0,0,0.05)" : "transparent" }}>
      <div className="recording-item-copy">
        <div className="recording-item-name" style={{ fontWeight: "bold" }}>{recording.filename}</div>
        <div className="recording-item-meta" style={{ fontSize: "0.85rem", color: "rgba(128, 128, 128, 0.8)" }}>
          {recording.frameCount} frames · {formatSize(recording.sizeBytes)} · {formatDateTime(recording.modifiedUtc)}
        </div>
      </div>
      <div className="recording-item-actions" style={{ display: "flex", gap: "0.5rem" }}>
        <Button small intent="primary" outlined onClick={onLoad}>
          Load
        </Button>
        <Button small onClick={onExport}>
          Export
        </Button>
        <Button small minimal intent="danger" onClick={onDelete}>
          Delete
        </Button>
      </div>
    </div>
  );
}

export function RecordingPanel({ liveSnapshot }: Props) {
  const [status, setStatus] = useState<RecordingStatus>(EMPTY_RECORDING_STATUS);
  const [recordings, setRecordings] = useState<RecordingSummary[]>([]);
  const [activeTab, setActiveTab] = useState<RecordingTab>("library");
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [actionBusy, setActionBusy] = useState(false);
  const [playbackBusy, setPlaybackBusy] = useState(false);
  const [playbackFile, setPlaybackFile] = useState<string | null>(null);
  const [playbackFrames, setPlaybackFrames] = useState<RecordingEntry[]>([]);
  const [playheadIdx, setPlayheadIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState(1);

  const chartData = useMemo(() => buildChartData(playbackFrames), [playbackFrames]);
  const currentFrame = playbackFrames[playheadIdx] ?? null;
  const currentSnapshot = currentFrame?.snap ?? null;
  const currentElapsed = currentFrame?.elapsed ?? 0;
  const totalElapsed = playbackFrames[playbackFrames.length - 1]?.elapsed ?? 0;

  useEffect(() => {
    const loadLibrary = async () => {
      setLibraryLoading(true);
      try {
        const response = await fetch(`${API_BASE}/api/recordings`);
        const data = await response.json();
        setRecordings(Array.isArray(data.recordings) ? data.recordings : []);
        if (data.status) {
          setStatus(data.status as RecordingStatus);
        }
      } finally {
        setLibraryLoading(false);
      }
    };

    void loadLibrary();
  }, []);

  useEffect(() => {
    if (!status.recording) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      const response = await fetch(`${API_BASE}/api/recordings/status`);
      const data = await response.json();
      setStatus(data as RecordingStatus);
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [status.recording]);

  useEffect(() => {
    if (!playing || playbackFrames.length === 0) {
      return;
    }

    if (playheadIdx >= playbackFrames.length - 1) {
      setPlaying(false);
      return;
    }

    const current = playbackFrames[playheadIdx];
    const next = playbackFrames[playheadIdx + 1];
    const delayMs = Math.max(40, Math.min(1000, ((next.elapsed - current.elapsed) * 1000) / playSpeed));
    const timeoutId = window.setTimeout(() => {
      setPlayheadIdx((value) => Math.min(value + 1, playbackFrames.length - 1));
    }, delayMs);

    return () => window.clearTimeout(timeoutId);
  }, [playSpeed, playbackFrames, playing, playheadIdx]);

  const refreshLibrary = async () => {
    setLibraryLoading(true);
    try {
      const response = await fetch(`${API_BASE}/api/recordings`);
      const data = await response.json();
      setRecordings(Array.isArray(data.recordings) ? data.recordings : []);
      if (data.status) {
        setStatus(data.status as RecordingStatus);
      }
    } finally {
      setLibraryLoading(false);
    }
  };

  const startRecording = async () => {
    setActionBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/recordings/start`, { method: "POST" });
      const data = await response.json();
      setStatus(data as RecordingStatus);
      setActiveTab("library");
      await refreshLibrary();
    } finally {
      setActionBusy(false);
    }
  };

  const stopRecording = async () => {
    setActionBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/recordings/stop`, { method: "POST" });
      const data = await response.json();
      setStatus(data as RecordingStatus);
      await refreshLibrary();
    } finally {
      setActionBusy(false);
    }
  };

  const loadRecording = async (filename: string) => {
    setPlaybackBusy(true);
    setPlaying(false);
    try {
      const response = await fetch(`${API_BASE}/api/recordings/${filename}`);
      const data = await response.json();
      const frames = Array.isArray(data.frames) ? (data.frames as RecordingEntry[]) : [];
      setPlaybackFile(filename);
      setPlaybackFrames(frames);
      setPlayheadIdx(0);
      setPlaySpeed(1);
      setActiveTab("playback");
    } finally {
      setPlaybackBusy(false);
    }
  };

  const exportRecording = async (filename: string) => {
    setActionBusy(true);
    try {
      const response = await fetch(`${API_BASE}/api/recordings/${filename}`);
      const data = await response.json();
      const frames = Array.isArray(data.frames) ? data.frames : [];
      const jsonlContent = frames.map((f: unknown) => JSON.stringify(f)).join('\n');
      const blob = new Blob([jsonlContent], { type: "application/jsonl" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } finally {
      setActionBusy(false);
    }
  };

  const deleteRecording = async (filename: string) => {
    setActionBusy(true);
    try {
      await fetch(`${API_BASE}/api/recordings/${filename}`, { method: "DELETE" });
      if (playbackFile === filename) {
        setPlaybackFile(null);
        setPlaybackFrames([]);
        setPlayheadIdx(0);
        setPlaying(false);
        setActiveTab("library");
      }
      await refreshLibrary();
    } finally {
      setActionBusy(false);
    }
  };

  const playbackSnapshot = currentSnapshot?.telemetry ?? null;
  const playbackValue = (path: string, suffix = "", fallback = "--") => {
    const value = playbackSnapshot ? getNestedValue(playbackSnapshot, path) : null;
    if (typeof value === "number" || typeof value === "string") {
      return fmt(value, suffix, fallback);
    }
    return fallback;
  };

  return (
    <div className="panel panel--wide recording-panel">
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
        <h3 style={{ margin: 0 }}>Flight Recorder</h3>
        <div className="panel-tags" style={{ display: "flex", gap: "0.5rem" }}>
          <Tag intent={status.recording ? "danger" : "success"}>{status.recording ? "recording" : "idle"}</Tag>
          <Tag minimal>{status.frameCount} frames</Tag>
        </div>
      </div>

      <div className="recording-toolbar" style={{ display: "flex", justifyContent: "space-between", marginBottom: "1rem" }}>
        <ButtonGroup>
          <Button intent="danger" onClick={startRecording} loading={actionBusy} disabled={status.recording}>
            Start recording
          </Button>
          <Button outlined intent="warning" onClick={stopRecording} loading={actionBusy} disabled={!status.recording}>
            Stop
          </Button>
          <Button minimal onClick={() => void refreshLibrary()} loading={libraryLoading}>
            Refresh
          </Button>
        </ButtonGroup>

        <div className="recording-tabs" style={{ display: "flex", gap: "0.5rem" }}>
          <Button
            active={activeTab === "library"}
            onClick={() => setActiveTab("library")}
          >
            Library
          </Button>
          <Button
            active={activeTab === "playback"}
            onClick={() => playbackFrames.length > 0 && setActiveTab("playback")}
            disabled={playbackFrames.length === 0}
          >
            Playback{playbackFrames.length > 0 ? ` (${playbackFrames.length})` : ""}
          </Button>
        </div>
      </div>

      <div className="recording-status-strip" style={{ display: "flex", gap: "2rem", padding: "1rem", background: "rgba(0,0,0,0.05)", borderRadius: "4px", marginBottom: "1rem" }}>
        <div className="recording-status-item" style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>Status</span>
          <strong>{status.recording ? "Recording live telemetry" : "Ready"}</strong>
        </div>
        <div className="recording-status-item" style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>File</span>
          <strong>{status.filename ?? "--"}</strong>
        </div>
        <div className="recording-status-item" style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>Elapsed</span>
          <strong>{fmt(status.elapsedSeconds, "s")}</strong>
        </div>
        <div className="recording-status-item" style={{ display: "flex", flexDirection: "column" }}>
          <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>Started</span>
          <strong>{formatDateTime(status.startedAtUtc)}</strong>
        </div>
      </div>

      {activeTab === "library" ? (
        <div className="recording-library">
          {libraryLoading ? (
            <div className="recording-empty" style={{ padding: "3rem", textAlign: "center" }}>
              <Spinner size={28} />
            </div>
          ) : recordings.length === 0 ? (
            <div className="recording-empty" style={{ padding: "3rem", textAlign: "center", opacity: 0.6 }}>
              <div className="precip-empty-title" style={{ fontSize: "1.2rem", fontWeight: "bold", marginBottom: "0.5rem" }}>No recordings yet</div>
              <div className="precip-empty-copy">
                Start recording and the backend will save telemetry snapshots to JSONL files.
              </div>
            </div>
          ) : (
            <div style={{ border: "1px solid rgba(128, 128, 128, 0.2)", borderRadius: "4px" }}>
              {recordings.map((recording) => (
                <RecordingItem
                  key={recording.filename}
                  recording={recording}
                  selected={recording.filename === playbackFile}
                  onLoad={() => void loadRecording(recording.filename)}
                  onExport={() => void exportRecording(recording.filename)}
                  onDelete={() => void deleteRecording(recording.filename)}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="recording-playback">
          {playbackBusy ? (
            <div className="recording-empty" style={{ padding: "3rem", textAlign: "center" }}>
              <Spinner size={28} />
            </div>
          ) : playbackFrames.length === 0 ? (
            <div className="recording-empty" style={{ padding: "3rem", textAlign: "center", opacity: 0.6 }}>
              <div className="precip-empty-title" style={{ fontSize: "1.2rem", fontWeight: "bold", marginBottom: "0.5rem" }}>Playback unavailable</div>
              <div className="precip-empty-copy">
                Load a saved recording from the library to inspect telemetry history.
              </div>
            </div>
          ) : (
            <>
              <div className="playback-toolbar" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
                <div className="playback-toolbar-main" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <ButtonGroup>
                    <Button minimal onClick={() => { setPlaying(false); setPlayheadIdx(0); }}>
                      First
                    </Button>
                    <Button minimal onClick={() => { setPlaying(false); setPlayheadIdx((value) => Math.max(0, value - 1)); }}>
                      Prev
                    </Button>
                    <Button intent="primary" onClick={() => setPlaying((value) => !value)}>
                      {playing ? "Pause" : "Play"}
                    </Button>
                    <Button minimal onClick={() => { setPlaying(false); setPlayheadIdx((value) => Math.min(playbackFrames.length - 1, value + 1)); }}>
                      Next
                    </Button>
                    <Button minimal onClick={() => { setPlaying(false); setPlayheadIdx(playbackFrames.length - 1); }}>
                      Last
                    </Button>
                  </ButtonGroup>
                  <Tag round large minimal>
                    {playbackFile}
                  </Tag>
                </div>

                <div className="playback-speed-row" style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                  <span style={{ fontSize: "0.85rem", opacity: 0.7 }}>Speed</span>
                  <ButtonGroup>
                    {PLAYBACK_SPEEDS.map((speed) => (
                      <Button
                        key={speed}
                        active={playSpeed === speed}
                        onClick={() => setPlaySpeed(speed)}
                      >
                        {speed}x
                      </Button>
                    ))}
                  </ButtonGroup>
                </div>
              </div>

              <div className="playback-scrubber" style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "2rem" }}>
                <span style={{ minWidth: "40px", textAlign: "right", fontFamily: "monospace" }}>{fmtFixed(currentElapsed, 1, "s")}</span>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, playbackFrames.length - 1)}
                  value={playheadIdx}
                  onChange={(event) => {
                    setPlaying(false);
                    setPlayheadIdx(Number(event.target.value));
                  }}
                  style={{ flex: 1 }}
                />
                <span style={{ minWidth: "40px", fontFamily: "monospace" }}>{fmtFixed(totalElapsed, 1, "s")}</span>
              </div>

              <div className="playback-summary-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
                <div className="playback-summary-card" style={{ padding: "1rem", background: "rgba(0,0,0,0.02)", border: "1px solid rgba(128,128,128,0.2)", borderRadius: "4px" }}>
                  <span style={{ display: "block", fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.25rem" }}>Frame</span>
                  <strong style={{ fontSize: "1.1rem" }}>{playheadIdx + 1} / {playbackFrames.length}</strong>
                </div>
                <div className="playback-summary-card" style={{ padding: "1rem", background: "rgba(0,0,0,0.02)", border: "1px solid rgba(128,128,128,0.2)", borderRadius: "4px" }}>
                  <span style={{ display: "block", fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.25rem" }}>Captured</span>
                  <strong style={{ fontSize: "1.1rem" }}>{formatDateTime(currentFrame?.t ?? null)}</strong>
                </div>
                <div className="playback-summary-card" style={{ padding: "1rem", background: "rgba(0,0,0,0.02)", border: "1px solid rgba(128,128,128,0.2)", borderRadius: "4px" }}>
                  <span style={{ display: "block", fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.25rem" }}>Live backend</span>
                  <strong style={{ fontSize: "1.1rem" }}>{liveSnapshot?.connected ? "Connected" : "Offline"}</strong>
                </div>
                <div className="playback-summary-card" style={{ padding: "1rem", background: "rgba(0,0,0,0.02)", border: "1px solid rgba(128,128,128,0.2)", borderRadius: "4px" }}>
                  <span style={{ display: "block", fontSize: "0.85rem", opacity: 0.7, marginBottom: "0.25rem" }}>Flight mode</span>
                  <strong style={{ fontSize: "1.1rem" }}>{currentSnapshot?.telemetry.flightMode ?? "--"}</strong>
                </div>
              </div>

              <div className="playback-metric-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: "1rem", marginBottom: "2rem" }}>
                {[
                  ["RSSI Ant1", playbackValue("linkStats.uplinkRssi1", " dBm")],
                  ["RSSI Ant2", playbackValue("linkStats.uplinkRssi2", " dBm")],
                  ["Voltage", playbackValue("battery.voltageV", " V")],
                  ["Current", playbackValue("battery.currentA", " A")],
                  ["Remaining", playbackValue("battery.remainingPct", "%")],
                  ["Latitude", playbackValue("gps.latitude")],
                  ["Longitude", playbackValue("gps.longitude")],
                  ["Altitude", playbackValue("gps.altitudeM", " m")],
                  ["Ground speed", playbackValue("gps.groundspeedKmh", " km/h")],
                  ["Vertical speed", playbackValue("gps.verticalSpeedMps", " m/s")],
                  ["Pitch", playbackValue("attitude.pitchDeg", " °")],
                  ["Roll", playbackValue("attitude.rollDeg", " °")],
                  ["Yaw", playbackValue("attitude.yawDeg", " °")],
                ].map(([label, value]) => (
                  <div key={label} className="playback-metric-card" style={{ padding: "0.75rem", background: "rgba(0,0,0,0.02)", borderRadius: "4px" }}>
                    <span style={{ display: "block", fontSize: "0.75rem", textTransform: "uppercase", opacity: 0.6, marginBottom: "0.25rem" }}>{label}</span>
                    <strong style={{ fontFamily: "monospace", fontSize: "1.1rem" }}>{value}</strong>
                  </div>
                ))}
              </div>

              <div className="recording-chart-stack">
                <TelemetryChart title="Link quality and RSSI" series={CHART_SERIES.link} data={chartData} playheadIdx={playheadIdx} />
                <TelemetryChart title="Battery" series={CHART_SERIES.battery} data={chartData} playheadIdx={playheadIdx} />
                <TelemetryChart title="GPS" series={CHART_SERIES.gps} data={chartData} playheadIdx={playheadIdx} />
                <TelemetryChart title="Attitude" series={CHART_SERIES.attitude} data={chartData} playheadIdx={playheadIdx} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}