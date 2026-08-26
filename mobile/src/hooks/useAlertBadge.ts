import { useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";
import { getAlerts } from "../api/receivables";

/** How often to re-check while the app is in the foreground. */
const POLL_MS = 120_000;

/**
 * The count on the Alerts tab.
 *
 * There's no push channel yet, so this polls — but only while the app is
 * actually in the foreground, and it refreshes on resume so a badge is never
 * stale-by-hours after a phone comes out of a pocket. Errors are swallowed on
 * purpose: a badge that shows an error is worse than one that shows nothing.
 */
export function useAlertBadge(): number {
  const [count, setCount] = useState(0);

  const refresh = useCallback(() => {
    getAlerts().then(f => setCount(f.actionable)).catch(() => {});
  }, []);

  useEffect(() => {
    refresh();
    const timer = setInterval(() => {
      if (AppState.currentState === "active") refresh();
    }, POLL_MS);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [refresh]);

  return count;
}
