export const colors = {
  bg: "#FAFAF9",
  card: "#FFFFFF",
  cardMuted: "#F5F5F4",
  border: "#E7E5E4",
  text: "#1C1917",
  textMuted: "#78716C",
  accent: "#0EA5E9",
  accentText: "#FFFFFF",
  danger: "#DC2626",
  success: "#16A34A",

  // ── Semantic hues, shared with the web app's collections palette ──────────
  // Aging buckets go emerald → amber → orange → rose → deep rose, so a glance
  // at the bar reads the same on a phone as on the board.
  aging: {
    current: "#10B981",
    d30: "#FBBF24",
    d60: "#F97316",
    d90: "#F43F5E",
    d90plus: "#9F1239",
  },
  // Promise = sky, dispute = rose, escalation = deep rose. Matching the board
  // matters: a rep looking at both should not have to relearn the colours.
  promise: "#0284C7",
  promiseBg: "#F0F9FF",
  dispute: "#E11D48",
  disputeBg: "#FFF1F2",
  warn: "#B45309",
  warnBg: "#FFFBEB",
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 };
