export type PortInfo = {
  device: string;
  description?: string | null;
  manufacturer?: string | null;
  product?: string | null;
  interface?: string | null;
  vid?: number | null;
  pid?: number | null;
  selected: boolean;
  score: number;
  label: string;
};

export type TelemetryTrackPoint = {
  latitude: number;
  longitude: number;
  altitudeM?: number;
};

export type TelemetryBattery = {
  voltageV?: number;
  currentA?: number;
  capacityMah?: number;
  capacityMaxMah?: number;
  remainingCapacityMah?: number;
  remainingPct?: number | null;
  reportedRemainingPct?: number;
  [key: string]: number | string | null | undefined;
};

export type TelemetryGps = {
  latitude?: number;
  longitude?: number;
  groundspeedKmh?: number;
  headingDeg?: number;
  altitudeM?: number;
  satellites?: number;
  verticalSpeedMps?: number | null;
  [key: string]: number | string | null | undefined;
};

export type TelemetryAttitude = {
  pitchDeg?: number;
  rollDeg?: number;
  yawDeg?: number;
  [key: string]: number | string | null | undefined;
};

export type TelemetrySnapshot = {
  connectionState: "disconnected" | "connecting" | "connected" | "error";
  connected: boolean;
  port: string | null;
  baud: number | null;
  lastError: string | null;
  telemetry: {
    uptimeSeconds: number;
    lastFrameAgoSeconds: number | null;
    totalFrames: number;
    framesPerSecond: number;
    frameCounts: Record<string, number>;
    linkStats: Record<string, number | string>;
    battery: TelemetryBattery;
    gps: TelemetryGps;
    gpsTrack: TelemetryTrackPoint[];
    attitude: TelemetryAttitude;
    flightMode: string | null;
    timing: Record<string, number | string>;
    unknownFrames: string[];
  };
};

export type RecordingStatus = {
  recording: boolean;
  filename: string | null;
  startedAtUtc: string | null;
  elapsedSeconds: number | null;
  frameCount: number;
};

export type RecordingSummary = {
  filename: string;
  sizeBytes: number;
  frameCount: number;
  modifiedUtc: string;
};

export type RecordingEntry = {
  t: string;
  elapsed: number;
  snap: TelemetrySnapshot;
};

export type ChmiPrecipitationSnapshot = {
  frames: Array<{
    filename: string;
    imagePath: string;
    imageUrl: string | null;
    frameTimeUtc: string;
    frameTimeLocal: string;
    ageMinutes: number | null;
  }>;
  ok: boolean;
  stale: boolean;
  provider: string;
  product: string;
  label: string;
  sourceUrl: string;
  bounds: {
    south: number;
    west: number;
    north: number;
    east: number;
  };
  imagePath: string | null;
  imageUrl: string | null;
  filename: string | null;
  frameTimeUtc: string | null;
  frameTimeLocal: string | null;
  ageMinutes: number | null;
  checkedAtUtc: string | null;
  error: string | null;
};

export type PortsResponse = {
  ports: PortInfo[];
  suggestedPort: string | null;
};
