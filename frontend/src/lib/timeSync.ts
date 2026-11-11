/**
 * timeSync.ts - Institutional Clock Skew & Timezone Health Monitor
 * Detects whether the local laptop clock is out of sync with authoritative NTP / Server time.
 */

export interface TimeSyncState {
  offsetMs: number; // authoritativeTime - deviceTime
  driftSeconds: number;
  isDesynced: boolean; // true if drift >= 45 seconds
  lastCheckedMs: number;
  userTimezone: string;
  serverTimeIso: string;
  deviceTimeIso: string;
  driftFormatted: string;
  isBehind: boolean;
}

export const INITIAL_TIME_SYNC_STATE: TimeSyncState = {
  offsetMs: 0,
  driftSeconds: 0,
  isDesynced: false,
  lastCheckedMs: 0,
  userTimezone: "UTC",
  serverTimeIso: "",
  deviceTimeIso: "",
  driftFormatted: "0s",
  isBehind: false,
};

function formatDrift(offsetMs: number): { formatted: string; isBehind: boolean } {
  const isBehind = offsetMs > 0;
  const absSec = Math.round(Math.abs(offsetMs) / 1000);

  if (absSec < 60) {
    return { formatted: `${absSec}s ${isBehind ? "behind" : "ahead"}`, isBehind };
  }
  const mins = Math.floor(absSec / 60);
  const secs = absSec % 60;
  if (mins < 60) {
    return { formatted: `${mins}m ${secs}s ${isBehind ? "behind" : "ahead"}`, isBehind };
  }
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return { formatted: `${hours}h ${remMins}m ${isBehind ? "behind" : "ahead"}`, isBehind };
}

class TimeSyncManager {
  private offsetMs = 0;
  private isDesynced = false;
  private listeners: ((state: TimeSyncState) => void)[] = [];
  private checkInterval: NodeJS.Timeout | null = null;

  constructor() {
    if (typeof window !== "undefined") {
      // Immediate check, then periodic check every 30s
      setTimeout(() => this.checkTimeSync(), 500);
      this.checkInterval = setInterval(() => this.checkTimeSync(), 30000);
    }
  }

  public async checkTimeSync(): Promise<TimeSyncState> {
    if (typeof window === "undefined") {
      return INITIAL_TIME_SYNC_STATE;
    }

    const startMs = Date.now();
    let authoritativeMs = 0;

    // 1. Try Backend /time endpoint (or /api/time)
    const timeEndpoints = [
      "/time",
      "/api/time",
      "http://localhost:8000/time",
      "http://localhost:8000/api/time",
    ];

    for (const ep of timeEndpoints) {
      try {
        const res = await fetch(ep, { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          const rtt = Date.now() - startMs;
          if (json.server_time_ms) {
            authoritativeMs = json.server_time_ms + Math.round(rtt / 2);
            break;
          }
          const dateH = res.headers.get("date");
          if (dateH) {
            authoritativeMs = new Date(dateH).getTime() + Math.round(rtt / 2);
            break;
          }
        }
      } catch {
        // continue
      }
    }

    // 2. Public NTP / Cloud Fallback (WorldTimeAPI, Wikipedia open headers)
    if (!authoritativeMs) {
      const publicFallbacks = [
        "https://worldtimeapi.org/api/timezone/Etc/UTC",
        "https://en.wikipedia.org/api/rest_v1/page/summary/Clock",
      ];
      for (const url of publicFallbacks) {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (res.ok) {
            if (url.includes("worldtimeapi")) {
              const json = await res.json();
              if (json.unixtime) {
                authoritativeMs = json.unixtime * 1000;
                break;
              }
            }
            const dateH = res.headers.get("date");
            if (dateH) {
              authoritativeMs = new Date(dateH).getTime();
              break;
            }
          }
        } catch {
          // continue
        }
      }
    }

    if (authoritativeMs > 0) {
      const now = Date.now();
      this.offsetMs = authoritativeMs - now;
      const driftSeconds = Math.round(Math.abs(this.offsetMs) / 1000);
      // Flag as desynced if difference is 45 seconds or greater
      this.isDesynced = driftSeconds >= 45;
    }

    const state = this.getState();
    this.notify(state);
    return state;
  }

  public getAccurateNow(): Date {
    if (typeof window === "undefined") {
      return new Date(0);
    }
    return new Date(Date.now() + this.offsetMs);
  }

  public getState(): TimeSyncState {
    if (typeof window === "undefined") {
      return INITIAL_TIME_SYNC_STATE;
    }

    const userTz = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "Unknown";
    const now = Date.now();
    const driftSec = Math.round(Math.abs(this.offsetMs) / 1000);
    const { formatted, isBehind } = formatDrift(this.offsetMs);

    return {
      offsetMs: this.offsetMs,
      driftSeconds: driftSec,
      isDesynced: this.isDesynced,
      lastCheckedMs: now,
      userTimezone: userTz,
      serverTimeIso: new Date(now + this.offsetMs).toISOString(),
      deviceTimeIso: new Date(now).toISOString(),
      driftFormatted: formatted,
      isBehind,
    };
  }

  public subscribe(cb: (state: TimeSyncState) => void): () => void {
    this.listeners.push(cb);
    if (typeof window !== "undefined") {
      cb(this.getState());
    }
    return () => {
      this.listeners = this.listeners.filter((l) => l !== cb);
    };
  }

  private notify(state: TimeSyncState) {
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // ignore subscriber errors
      }
    }
  }

  public destroy() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }
  }
}

export const timeSync = new TimeSyncManager();
