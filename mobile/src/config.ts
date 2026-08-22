import Constants from "expo-constants";

// Set via app.json `expo.extra.apiBaseUrl`, or override per-build with
// EXPO_PUBLIC_API_BASE_URL (e.g. a LAN IP or tunnel URL while developing —
// a phone/simulator can't reach your laptop via "localhost").
export const API_BASE_URL: string =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ||
  "https://app.primeaccountax.com";
