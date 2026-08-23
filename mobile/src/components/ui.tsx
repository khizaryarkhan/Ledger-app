import React from "react";
import {
  ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewProps,
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
