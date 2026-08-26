import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TabScreenProps } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { Card, EmptyState } from "../components/ui";
import { departmentsForRole } from "../departments";
import { colors, spacing } from "../theme";

type Props = TabScreenProps<"HomeTab">;

export default function HomeScreen({ navigation }: Props) {
  const { state } = useAuth();
  const org = state.status === "signedIn" ? state.org : null;
  const user = state.status === "signedIn" ? state.user : null;
  const role = state.status === "signedIn" ? state.role : null;

  const departments = departmentsForRole(role);
  const firstName = (user?.name ?? "").split(" ")[0] || "there";

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
      >
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={{ fontSize: 24, fontWeight: "700", color: colors.text }}>Hi, {firstName}</Text>
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
                  <Card style={{ marginBottom: spacing.sm, flexDirection: "row", alignItems: "center" }}>
                    <View style={{
                      width: 42, height: 42, borderRadius: 10, backgroundColor: colors.cardMuted,
                      alignItems: "center", justifyContent: "center", marginRight: spacing.md,
                    }}>
                      <Ionicons name={item.icon as any} size={21} color={colors.accent} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{item.title}</Text>
                      <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{item.subtitle}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                  </Card>
                </Pressable>
              ))}
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
