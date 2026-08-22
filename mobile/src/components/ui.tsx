import React from "react";
import {
  ActivityIndicator, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewProps,
} from "react-native";
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
  emptyState: { padding: spacing.xl, alignItems: "center" },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
});
