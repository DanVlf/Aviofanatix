export const fmt = (value?: number | string | null, suffix = "", fallback = "--") => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") {
    return `${value.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1")}${suffix}`;
  }
  return `${value}${suffix}`;
};

export const fmtFixed = (
  value: number | string | null | undefined,
  digits: number,
  suffix = "",
  fallback = "--",
) => {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") {
    return `${value.toFixed(digits)}${suffix}`;
  }
  return `${value}${suffix}`;
};

export const defaultApiBase = (() => {
  if (typeof window === "undefined") return "http://localhost:5001";
  return `${window.location.protocol}//${window.location.hostname}:5001`;
})();

export const API_BASE = (import.meta as Record<string, any>).env?.VITE_API_BASE_URL ?? defaultApiBase;
export const DEFAULT_BAUD = 420000;
