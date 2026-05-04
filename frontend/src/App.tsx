import { useEffect, useRef, useState } from "react";
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

export function App() {
  const [snapshot, setSnapshot] = useState<TelemetrySnapshot | null>(null);
  const [chmiSnapshot, setChmiSnapshot] = useState<ChmiPrecipitationSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [chmiLoading, setChmiLoading] = useState(true);
  const [streamOnline, setStreamOnline] = useState(false);
  const [toastError, setToastError] = useState<string | null>(null);
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
            ok: false,
            stale: false,
            provider: "CHMI",
            product: "pseudocappi2km",
            label: "Live radar over the Czech Republic",
            sourceUrl: "https://opendata.chmi.cz/meteorology/weather/radar/composite/pseudocappi2km/png/",
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

  const attitude = snapshot?.telemetry.attitude;

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
                <ChmiPrecipitationPanel snapshot={chmiSnapshot} loading={chmiLoading} />
                <SessionPanel snapshot={snapshot} />
                <LinkPanel snapshot={snapshot} />
                <BatteryPanel snapshot={snapshot} />
                <GpsPanel snapshot={snapshot} />
                <AttitudePanel snapshot={snapshot} />
                <FramesPanel snapshot={snapshot} />
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
