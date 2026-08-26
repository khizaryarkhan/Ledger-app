import React from "react";
import { Alert, Linking, Text, View } from "react-native";
import Constants from "expo-constants";
import type { TabScreenProps } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { API_BASE_URL } from "../config";
import { departmentsForRole } from "../departments";
import { Button, Card, KeyValue, Pill, Screen, SectionTitle } from "../components/ui";
import { colors, spacing } from "../theme";

type Props = TabScreenProps<"ProfileTab">;

/** Role keys are internal; show people the label the web app uses. */
const ROLE_LABELS: Record<string, string> = {
  rep: "Rep / PM",
  company_user: "Full access",
  company_admin: "Administrator",
  super_admin: "Super administrator",
  platform_admin: "Platform administrator",
};

export default function ProfileScreen({}: Props) {
  const { state, signOut } = useAuth();
  const user = state.status === "signedIn" ? state.user : null;
  const org = state.status === "signedIn" ? state.org : null;
  const role = state.status === "signedIn" ? state.role : null;

  const departments = departmentsForRole(role);
  const version = Constants.expoConfig?.version ?? "—";

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>{user?.name ?? "—"}</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{user?.email ?? "—"}</Text>
        <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.md }}>
          <Pill label={ROLE_LABELS[role ?? ""] ?? role ?? "—"} tone="promise" />
        </View>
      </Card>

      <SectionTitle title="Organisation" />
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <KeyValue label="Signed in to" value={org?.name ?? "—"} />
          <KeyValue label="Departments" value={departments.map(d => d.title).join(", ") || "None"} />
        </View>
        {/* Switching org means new tokens for that org, and the token exchange
            runs at sign-in — so this is honest about needing a re-login rather
            than half-switching and leaving stale data on screen. */}
        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: spacing.xs }}>
          To work in a different organisation, sign out and sign back in — you'll be asked which one.
        </Text>
      </Card>

      <SectionTitle title="App" />
      <Card>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <KeyValue label="Version" value={version} />
          <KeyValue label="Server" value={API_BASE_URL.replace(/^https?:\/\//, "")} />
        </View>
        <Button
          title="Open the web app"
          variant="secondary"
          onPress={() => Linking.openURL(API_BASE_URL)}
        />
      </Card>

      <View style={{ marginTop: spacing.lg }}>
        <Button
          title="Sign out"
          variant="secondary"
          onPress={() => Alert.alert("Sign out?", "You'll need your password to sign back in.", [
            { text: "Cancel", style: "cancel" },
            { text: "Sign out", style: "destructive", onPress: signOut },
          ])}
        />
      </View>
    </Screen>
  );
}
