import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Icon, Spinner } from "@blueprintjs/core";
import type { ChmiPrecipitationSnapshot, TelemetrySnapshot } from "./lib/types";
import { API_BASE } from "./lib/utils";
import { AppNavbar } from "./components/layout/AppNavbar";
import { SessionPanel } from "./components/panels/SessionPanel";
import { LinkPanel } from "./components/panels/LinkPanel";
import { BatteryPanel } from "./components/panels/BatteryPanel";
import { GpsPanel } from "./components/panels/GpsPanel";
import { AttitudePanel } from "./components/panels/AttitudePanel";
import { FramesPanel } from "./components/panels/FramesPanel";
import { ChmiPrecipitationPanel } from "./components/panels/ChmiPrecipitationPanel";
import { DroneViewer } from "./components/viewers/DroneViewer";

type DashboardPanelId =
  | "radar"
  | "session"
  | "link"
  | "battery"
  | "gps"
  | "attitude"
  | "frames";

type DashboardPanelConfig = {
  id: DashboardPanelId;
  wide?: boolean;
  content: ReactNode;
};

type DraggablePanelSlotProps = {
  panelId: DashboardPanelId;
  wide?: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (panelId: DashboardPanelId) => void;
  onDragOver: (panelId: DashboardPanelId) => void;
  onDrop: (panelId: DashboardPanelId) => void;
  onDragEnd: () => void;
  children: ReactNode;
};

const DASHBOARD_PANEL_ORDER_KEY = "cansat.dashboard.panelOrder";
const DEFAULT_PANEL_ORDER: DashboardPanelId[] = [
  "radar",
  "session",
  "link",
  "battery",
  "gps",
  "attitude",
  "frames",
];

const isDashboardPanelId = (value: string): value is DashboardPanelId =>
  DEFAULT_PANEL_ORDER.includes(value as DashboardPanelId);

const normalizePanelOrder = (value: string[] | DashboardPanelId[]): DashboardPanelId[] => {
  const unique: DashboardPanelId[] = [];
  for (const item of value) {
    if (!isDashboardPanelId(item) || unique.includes(item)) {
      continue;
    }
    unique.push(item);
  }
  const missing = DEFAULT_PANEL_ORDER.filter((item) => !unique.includes(item));
  return [...unique, ...missing];
};

const movePanel = (order: DashboardPanelId[], draggedId: DashboardPanelId, targetId: DashboardPanelId) => {
  if (draggedId === targetId) {
    return order;
  }

  const next = [...order];
  const fromIndex = next.indexOf(draggedId);
  const toIndex = next.indexOf(targetId);
  if (fromIndex === -1 || toIndex === -1) {
    return order;
  }

  next.splice(fromIndex, 1);
  next.splice(toIndex, 0, draggedId);
  return next;
};

function DraggablePanelSlot({
  panelId,
  wide,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  children,
}: DraggablePanelSlotProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const [rowSpan, setRowSpan] = useState(1);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    const content = contentRef.current;
    if (!wrapper || !content) {
      return;
    }

    const recalc = () => {
      const grid = wrapper.parentElement;
      if (!grid) {
        return;
      }

      const gridStyle = window.getComputedStyle(grid);
      const rowGap = parseFloat(gridStyle.rowGap || "0");
      const autoRow = parseFloat(gridStyle.gridAutoRows || "1");
      const contentHeight = content.getBoundingClientRect().height;
      if (autoRow <= 0) {
        return;
      }

      const nextSpan = Math.max(1, Math.ceil((contentHeight + rowGap) / (autoRow + rowGap)));
      setRowSpan((current) => (current === nextSpan ? current : nextSpan));
    };

    recalc();
    const observer = new ResizeObserver(recalc);
    observer.observe(content);
    window.addEventListener("resize", recalc);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", recalc);
    };
  }, [children]);

  const handleNativeDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", panelId);
    onDragStart(panelId);
  };

  return (
    <div
      ref={wrapperRef}
      className={[
        "dashboard-panel-slot",
        wide ? "dashboard-panel-slot--wide" : "",
        isDragging ? "is-dragging" : "",
        isDragOver ? "is-drag-over" : "",
      ].filter(Boolean).join(" ")}
      style={{ gridRowEnd: `span ${rowSpan}` }}
      draggable
      onDragStart={handleNativeDragStart}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDragOver(panelId);
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop(panelId);
      }}
      onDragEnd={onDragEnd}
    >
      <div ref={contentRef} className="dashboard-panel-slot__inner">
        {children}
      </div>
    </div>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [chmiSnapshot, setChmiSnapshot] = useState<ChmiPrecipitationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [chmiLoading, setChmiLoading] = useState(true);
  const [streamOnline, setStreamOnline] = useState(false);
  const [toastError, setToastError] = useState<string | null>(null);
  const [panelOrder, setPanelOrder] = useState<DashboardPanelId[]>(() => {
    if (typeof window === "undefined") {
      return DEFAULT_PANEL_ORDER;
    }

    try {
      const raw = window.localStorage.getItem(DASHBOARD_PANEL_ORDER_KEY);
      if (!raw) {
        return DEFAULT_PANEL_ORDER;
      }

      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? normalizePanelOrder(parsed) : DEFAULT_PANEL_ORDER;
    } catch {
      return DEFAULT_PANEL_ORDER;
    }
  });
  const [draggedPanelId, setDraggedPanelId] = useState<DashboardPanelId | null>(null);
  const [dragOverPanelId, setDragOverPanelId] = useState<DashboardPanelId | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const lastErrorRef = useRef<string | null>(null);

  const fetchJson = async <T,>(url: string): Promise<T> => {
    const res = await fetch(url);
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();

    if (!res.ok) {
      throw new Error(`Request failed with status ${res.status}.`);
    }

    if (!contentType.includes("application/json")) {
      const preview = body.trim().slice(0, 80);
      if (preview.toLowerCase().startsWith("<!doctype") || preview.toLowerCase().startsWith("<html")) {
        throw new Error("Backend returned HTML instead of JSON. Restart the backend so the CHMI route is loaded.");
      }
      throw new Error("Backend returned an unexpected response instead of JSON.");
    }

    return JSON.parse(body) as T;
  };

  const loadSnapshot = async () => {
    const data = await fetchJson<TelemetrySnapshot>(`${API_BASE}/api/telemetry`);
    setSnapshot(data);
  };

  const loadChmiSnapshot = async () => {
    const data = await fetchJson<ChmiPrecipitationSnapshot>(`${API_BASE}/api/chmi/precipitation`);
    setChmiSnapshot(data);
  };

  useEffect(() => {
    void loadSnapshot().finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let active = true;

    const refreshChmi = async () => {
      try {
        await loadChmiSnapshot();
      } catch (error) {
        if (!active) return;
        setChmiSnapshot((previous) => {
          if (previous !== null) {
            return previous;
          }

          return {
            frames: [],
            ok: false,
            stale: false,
            provider: "CHMI",
            product: "maxz",
            label: "Live MAX_Z radar over the Czech Republic",
            sourceUrl: "https://opendata.chmi.cz/meteorology/weather/radar/composite/maxz/png/",
            bounds: {
              south: 48.047,
              west: 11.267,
              north: 52.167,
              east: 20.77,
            },
            imagePath: null,
            imageUrl: null,
            filename: null,
            frameTimeUtc: null,
            frameTimeLocal: null,
            ageMinutes: null,
            checkedAtUtc: new Date().toISOString(),
            error: error instanceof Error ? error.message : "Failed to load CHMI precipitation data.",
          };
        });
      } finally {
        if (active) {
          setChmiLoading(false);
        }
      }
    };

    void refreshChmi();
    const intervalId = window.setInterval(() => {
      void refreshChmi();
    }, 30_000);

    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const source = new EventSource(`${API_BASE}/api/stream`);
    eventSourceRef.current = source;
    source.onopen = () => setStreamOnline(true);
    source.onmessage = (e) => {
      setStreamOnline(true);
      const data = JSON.parse(e.data) as TelemetrySnapshot;
      setSnapshot(data);
    };
    source.onerror = () => setStreamOnline(false);
    return () => { source.close(); eventSourceRef.current = null; };
  }, []);

  useEffect(() => {
    const nextError = snapshot?.lastError ?? null;
    if (!nextError || nextError === lastErrorRef.current) {
      return;
    }

    lastErrorRef.current = nextError;
    setToastError(nextError);

    const timeoutId = window.setTimeout(() => {
      setToastError((current) => (current === nextError ? null : current));
    }, 6000);

    return () => window.clearTimeout(timeoutId);
  }, [snapshot?.lastError]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DASHBOARD_PANEL_ORDER_KEY, JSON.stringify(panelOrder));
    } catch {
      // Ignore storage failures and keep the current in-memory order.
    }
  }, [panelOrder]);

  const attitude = snapshot?.telemetry.attitude;
  const telemetrySnapshot = snapshot as TelemetrySnapshot;
  const panelConfigs: Record<DashboardPanelId, DashboardPanelConfig> = {
    radar: {
      id: "radar",
      wide: true,
      content: <ChmiPrecipitationPanel snapshot={chmiSnapshot} loading={chmiLoading} />,
    },
    session: {
      id: "session",
      content: <SessionPanel snapshot={telemetrySnapshot} />,
    },
    link: {
      id: "link",
      content: <LinkPanel snapshot={telemetrySnapshot} />,
    },
    battery: {
      id: "battery",
      content: <BatteryPanel snapshot={telemetrySnapshot} />,
    },
    gps: {
      id: "gps",
      content: <GpsPanel snapshot={telemetrySnapshot} />,
    },
    attitude: {
      id: "attitude",
      content: <AttitudePanel snapshot={telemetrySnapshot} />,
    },
    frames: {
      id: "frames",
      content: <FramesPanel snapshot={telemetrySnapshot} />,
    },
  };

  const handlePanelDragStart = (panelId: DashboardPanelId) => {
    setDraggedPanelId(panelId);
    setDragOverPanelId(panelId);
  };

  const handlePanelDragOver = (targetId: DashboardPanelId) => {
    if (!draggedPanelId || draggedPanelId === targetId) {
      return;
    }
    setDragOverPanelId(targetId);
  };

  const handlePanelDrop = (targetId: DashboardPanelId) => {
    if (!draggedPanelId) {
      return;
    }

    setPanelOrder((current) => movePanel(current, draggedPanelId, targetId));
    setDraggedPanelId(null);
    setDragOverPanelId(null);
  };

  const resetDragState = () => {
    setDraggedPanelId(null);
    setDragOverPanelId(null);
  };

  return (
    <div className="app-shell">
      <div className="backdrop" />
      <AppNavbar streamOnline={streamOnline} apiBase={API_BASE} />

      {toastError ? (
        <div className="error-toast" role="alert" aria-live="assertive">
          <div className="error-toast-icon">
            <Icon icon="warning-sign" size={16} />
          </div>
          <div className="error-toast-body">
            <div className="error-toast-title">Connection error</div>
            <div className="error-toast-message">{toastError}</div>
          </div>
          <button className="error-toast-close" onClick={() => setToastError(null)} aria-label="Dismiss error">
            ×
          </button>
        </div>
      ) : null}

      <main className="app-content">
        {loading || snapshot === null ? (
          <div className="loading-state">
            <Spinner size={48} />
          </div>
        ) : (
          <div className="dashboard">
            <div className="dashboard-left">
              <div className="panels-grid">
                {panelOrder.map((panelId) => {
                  const panel = panelConfigs[panelId];
                  const isDragging = draggedPanelId === panelId;
                  const isDragOver = dragOverPanelId === panelId && draggedPanelId !== panelId;

                  return (
                    <DraggablePanelSlot
                      key={panel.id}
                      panelId={panel.id}
                      wide={panel.wide}
                      isDragging={isDragging}
                      isDragOver={isDragOver}
                      onDragStart={handlePanelDragStart}
                      onDragOver={handlePanelDragOver}
                      onDrop={handlePanelDrop}
                      onDragEnd={resetDragState}
                    >
                      {panel.content}
                    </DraggablePanelSlot>
                  );
                })}
              </div>
            </div>
            <div className="dashboard-right">
              <DroneViewer
                pitch={typeof attitude?.pitchDeg === "number" ? attitude.pitchDeg : 0}
                roll={typeof attitude?.rollDeg === "number" ? attitude.rollDeg : 0}
                yaw={typeof attitude?.yawDeg === "number" ? attitude.yawDeg : 0}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
