import React, { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Button, ErrorBanner, Field, Screen } from "../components/ui";
import { ApiError } from "../api/client";
import { colors, spacing } from "../theme";

export default function LoginScreen({ initialError }: { initialError?: string }) {
  const { submitLogin } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  const onSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      await submitLogin(email.trim(), password, mfaCode || undefined);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
      setError(message);
      // A generic "invalid" response is also what a missing MFA code produces —
      // reveal the field so an enrolled user can retry with their code.
      if (message.toLowerCase().includes("authentication code") || message.toLowerCase().includes("invalid")) {
        setNeedsMfa(true);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        <Screen style={{ justifyContent: "center" }}>
          <View style={{ marginBottom: spacing.xl }}>
            <Text style={{ fontSize: 28, fontWeight: "700", color: colors.text }}>Prime Accountax</Text>
            <Text style={{ fontSize: 15, color: colors.textMuted, marginTop: spacing.xs }}>
              Sign in to manage receiving, production &amp; shipping
            </Text>
          </View>
          <ErrorBanner message={error} />
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="username"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoCapitalize="none"
            textContentType="password"
          />
          {needsMfa && (
            <Field
              label="Authentication code"
              value={mfaCode}
              onChangeText={setMfaCode}
              keyboardType="number-pad"
              placeholder="6-digit code or recovery code"
            />
          )}
          <Button title="Sign in" onPress={onSubmit} loading={loading} disabled={!email || !password} />
        </Screen>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
