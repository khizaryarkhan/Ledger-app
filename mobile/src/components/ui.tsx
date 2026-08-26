import React from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, TextInputProps,
  View, ViewProps,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing } from "../theme";

export function Screen({ children, style }: ViewProps) {
  return <View style={[styles.screen, style]}>{children}</View>;
}

export function Card({ children, style }: ViewProps) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} placeholderTextColor={colors.textMuted} {...props} />
    </View>
  );
}

export function Button({
  title, onPress, disabled, loading, variant = "primary",
}: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean; variant?: "primary" | "secondary" }) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.button,
        variant === "secondary" ? styles.buttonSecondary : styles.buttonPrimary,
        (disabled || loading) && { opacity: 0.5 },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === "secondary" ? colors.text : colors.accentText} />
      ) : (
        <Text style={variant === "secondary" ? styles.buttonTextSecondary : styles.buttonTextPrimary}>{title}</Text>
      )}
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function SuccessBanner({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View style={styles.successBanner}>
      <Text style={styles.successText}>{message}</Text>
    </View>
  );
}

/**
 * Full-screen searchable single-select. A warehouse item register can run to
 * hundreds of SKUs, so picking one needs a filter box rather than a long
 * scroll or a native wheel picker.
 */
export function PickerModal<T>({
  visible, title, items, keyOf, labelOf, sublabelOf, onSelect, onClose,
}: {
  visible: boolean;
  title: string;
  items: T[];
  keyOf: (item: T) => string;
  labelOf: (item: T) => string;
  sublabelOf?: (item: T) => string | null;
  onSelect: (item: T) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? items.filter((i) => `${labelOf(i)} ${sublabelOf?.(i) ?? ""}`.toLowerCase().includes(needle))
    : items;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={styles.pickerHeader}>
          <Text style={{ fontSize: 17, fontWeight: "700", color: colors.text }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text style={{ fontSize: 16, color: colors.accent, fontWeight: "600" }}>Close</Text>
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md }}>
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search…"
            placeholderTextColor={colors.textMuted}
            autoCorrect={false}
            autoFocus
          />
        </View>
        <FlatList
          data={shown}
          keyExtractor={keyOf}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ padding: spacing.lg }}
          ListEmptyComponent={<EmptyState message="Nothing matches that search." />}
          renderItem={({ item }) => (
            <Pressable onPress={() => { setQuery(""); onSelect(item); }}>
              <Card style={{ marginBottom: spacing.sm }}>
                <Text style={{ fontSize: 16, color: colors.text }}>{labelOf(item)}</Text>
                {sublabelOf?.(item) ? (
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{sublabelOf(item)}</Text>
                ) : null}
              </Card>
            </Pressable>
          )}
        />
      </SafeAreaView>
    </Modal>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color={colors.accent} />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: spacing.lg },
  card: {
    backgroundColor: colors.card, borderRadius: 12, padding: spacing.lg,
    borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md,
  },
  label: { fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: spacing.xs },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm, fontSize: 16, color: colors.text, backgroundColor: colors.card,
  },
  button: { borderRadius: 8, paddingVertical: spacing.md, alignItems: "center", justifyContent: "center" },
  buttonPrimary: { backgroundColor: colors.accent },
  buttonSecondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  buttonTextPrimary: { color: colors.accentText, fontSize: 16, fontWeight: "600" },
  buttonTextSecondary: { color: colors.text, fontSize: 16, fontWeight: "600" },
  errorBanner: { backgroundColor: "#FEF2F2", borderColor: "#FECACA", borderWidth: 1, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md },
  errorText: { color: colors.danger, fontSize: 14 },
  successBanner: { backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", borderWidth: 1, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md },
  successText: { color: colors.success, fontSize: 14 },
  pickerHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.card,
  },
  emptyState: { padding: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});

// ── Collections primitives ──────────────────────────────────────────────────

export type PillTone = "neutral" | "promise" | "dispute" | "danger" | "success" | "warn";

const PILL_TONES: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.cardMuted, fg: colors.textMuted },
  promise: { bg: colors.promiseBg, fg: colors.promise },
  dispute: { bg: colors.disputeBg, fg: colors.dispute },
  danger: { bg: "#FEF2F2", fg: colors.danger },
  success: { bg: "#F0FDF4", fg: colors.success },
  warn: { bg: colors.warnBg, fg: colors.warn },
};

export function Pill({ label, tone = "neutral" }: { label: string; tone?: PillTone }) {
  const t = PILL_TONES[tone];
  return (
    <View style={[extraStyles.pill, { backgroundColor: t.bg }]}>
      <Text style={[extraStyles.pillText, { color: t.fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

/**
 * The aging bar from the board/portal: one stacked strip plus a legend of the
 * buckets that are actually present. Segments under 0.5% are dropped so a
 * rounding remainder can't draw a hairline nobody can read.
 */
export function AgingBar({ buckets }: {
  buckets: { current: number; d30: number; d60: number; d90: number; d90plus: number; total: number };
}) {
  if (!buckets || buckets.total <= 0) return null;
  const parts = [
    { key: "current", label: "Current", value: buckets.current, color: colors.aging.current },
    { key: "d30", label: "1–30d", value: buckets.d30, color: colors.aging.d30 },
    { key: "d60", label: "31–60d", value: buckets.d60, color: colors.aging.d60 },
    { key: "d90", label: "61–90d", value: buckets.d90, color: colors.aging.d90 },
    { key: "d90plus", label: "90+d", value: buckets.d90plus, color: colors.aging.d90plus },
  ].map(p => ({ ...p, pct: (p.value / buckets.total) * 100 })).filter(p => p.pct >= 0.5);

  return (
    <View style={{ marginTop: spacing.md }}>
      <View style={extraStyles.agingTrack}>
        {parts.map(p => (
          <View key={p.key} style={{ width: `${p.pct}%`, backgroundColor: p.color, height: "100%" }} />
        ))}
      </View>
      <View style={extraStyles.agingLegend}>
        {parts.map(p => (
          <View key={p.key} style={{ flexDirection: "row", alignItems: "center", marginRight: spacing.md, marginTop: spacing.xs }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.color, marginRight: 4 }} />
            <Text style={{ fontSize: 11, color: colors.textMuted }}>
              {p.label} <Text style={{ fontWeight: "700", color: colors.text }}>{p.pct.toFixed(0)}%</Text>
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "danger" | "default" }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={extraStyles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[extraStyles.statValue, tone === "danger" && { color: colors.danger }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={extraStyles.statSub}>{sub}</Text> : null}
    </View>
  );
}

/** Horizontal filter/segment control. Scrolls when the options outrun the width. */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing.md }}>
      {options.map(o => {
        const active = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => onChange(o.key)} style={[extraStyles.segment, active && extraStyles.segmentActive]}>
            <Text style={[extraStyles.segmentText, active && extraStyles.segmentTextActive]}>
              {o.label}{o.count != null ? ` ${o.count}` : ""}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function SearchBar({ value, onChangeText, placeholder }: {
  value: string; onChangeText: (v: string) => void; placeholder?: string;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder ?? "Search…"}
        placeholderTextColor={colors.textMuted}
        autoCorrect={false}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        returnKeyType="search"
      />
    </View>
  );
}

export function SectionTitle({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <View style={extraStyles.sectionTitleRow}>
      <Text style={extraStyles.sectionTitle}>{title.toUpperCase()}</Text>
      {action && onAction ? (
        <Pressable onPress={onAction} hitSlop={8}>
          <Text style={{ fontSize: 13, fontWeight: "600", color: colors.accent }}>{action}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function KeyValue({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" }) {
  return (
    <View style={{ width: "50%", marginBottom: spacing.md }}>
      <Text style={extraStyles.statLabel}>{label.toUpperCase()}</Text>
      <Text style={[
        { fontSize: 15, fontWeight: "600", color: colors.text, marginTop: 2 },
        tone === "danger" && { color: colors.danger },
        tone === "success" && { color: colors.success },
      ]}>{value}</Text>
    </View>
  );
}

/** A tinted callout — the promise / dispute / escalation banners. */
export function Callout({ tone, title, body }: { tone: PillTone; title: string; body?: string | null }) {
  const t = PILL_TONES[tone];
  return (
    <View style={[extraStyles.callout, { backgroundColor: t.bg, borderColor: t.fg }]}>
      <Text style={{ fontSize: 13, fontWeight: "700", color: t.fg }}>{title}</Text>
      {body ? <Text style={{ fontSize: 13, color: t.fg, marginTop: 2 }}>{body}</Text> : null}
    </View>
  );
}

const extraStyles = StyleSheet.create({
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, alignSelf: "flex-start" },
  pillText: { fontSize: 11, fontWeight: "700" },
  agingTrack: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden", backgroundColor: colors.cardMuted },
  agingLegend: { flexDirection: "row", flexWrap: "wrap", marginTop: 2 },
  statLabel: { fontSize: 10, fontWeight: "700", letterSpacing: 0.6, color: colors.textMuted },
  statValue: { fontSize: 20, fontWeight: "700", color: colors.text, marginTop: 2 },
  statSub: { fontSize: 11, color: colors.textMuted, marginTop: 2 },
  segment: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, marginRight: spacing.sm,
  },
  segmentActive: { backgroundColor: colors.text, borderColor: colors.text },
  segmentText: { fontSize: 13, fontWeight: "600", color: colors.textMuted },
  segmentTextActive: { color: "#FFFFFF" },
  sectionTitleRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: spacing.lg, marginBottom: spacing.sm,
  },
  sectionTitle: { fontSize: 11, fontWeight: "700", letterSpacing: 0.7, color: colors.textMuted },
  callout: { borderWidth: 1, borderRadius: 10, padding: spacing.md, marginBottom: spacing.md },
});
