import React, { useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useAuth } from "../auth/AuthContext";
import { Card, ErrorBanner, Screen } from "../components/ui";
import { ApiError } from "../api/client";
import { colors, spacing } from "../theme";
import type { Org } from "../api/types";

export default function OrgSelectScreen({ orgs }: { orgs: Org[] }) {
  const { submitOrgSelection, signOut } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<string | null>(null);

  const onSelect = async (orgId: string) => {
    setSelecting(orgId);
    setError(null);
    try {
      await submitOrgSelection(orgId);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not select that organisation.");
      setSelecting(null);
    }
  };

  return (
    <Screen>
      <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text, marginBottom: spacing.sm }}>
        Choose an organisation
      </Text>
      <ErrorBanner message={error} />
      <FlatList
        data={orgs}
        keyExtractor={(o) => o.id}
        renderItem={({ item }) => (
          <Pressable onPress={() => onSelect(item.id)} disabled={selecting !== null}>
            <Card style={{ opacity: selecting && selecting !== item.id ? 0.5 : 1 }}>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{item.name}</Text>
            </Card>
          </Pressable>
        )}
      />
      <Pressable onPress={signOut} style={{ marginTop: spacing.md, alignItems: "center" }}>
        <Text style={{ color: colors.textMuted }}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}
