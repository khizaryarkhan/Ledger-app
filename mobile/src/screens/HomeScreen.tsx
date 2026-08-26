import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { Card, EmptyState, Screen } from "../components/ui";
import { departmentsForRole } from "../departments";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

export default function HomeScreen({ navigation }: Props) {
  const { state, signOut } = useAuth();
  const org = state.status === "signedIn" ? state.org : null;
  const user = state.status === "signedIn" ? state.user : null;
  const role = state.status === "signedIn" ? state.role : null;

  const departments = departmentsForRole(role);
  const firstName = (user?.name ?? "").split(" ")[0] || "there";

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text }}>Hi, {firstName}</Text>
          <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.xs }}>{org?.name}</Text>
        </View>

        {departments.length === 0 ? (
          <EmptyState message="Your account has no mobile departments enabled yet. Ask an administrator to check your role." />
        ) : (
          departments.map((dept) => (
            <View key={dept.key} style={{ marginBottom: spacing.lg }}>
              <Text style={{ fontSize: 11, fontWeight: "700", letterSpacing: 0.7, color: colors.textMuted }}>
                {dept.title.toUpperCase()}
              </Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm }}>
                {dept.blurb}
              </Text>
              {dept.items.map((item) => (
                <Pressable key={item.key} onPress={() => navigation.navigate(item.route as any)}>
                  <Card style={{ marginBottom: spacing.sm }}>
                    <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{item.title}</Text>
                    <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: spacing.xs }}>{item.subtitle}</Text>
                  </Card>
                </Pressable>
              ))}
            </View>
          ))
        )}

        <Pressable onPress={signOut} style={{ marginTop: spacing.md, marginBottom: spacing.xl, alignItems: "center" }}>
          <Text style={{ color: colors.textMuted }}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
