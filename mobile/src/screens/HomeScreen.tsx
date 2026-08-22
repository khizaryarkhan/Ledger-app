import React from "react";
import { Pressable, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { Card, Screen } from "../components/ui";
import { colors, spacing } from "../theme";

type Props = NativeStackScreenProps<RootStackParamList, "Home">;

const TILES: { title: string; subtitle: string; route: keyof RootStackParamList }[] = [
  { title: "Receiving", subtitle: "Post a goods receipt against an open PO", route: "ReceivingList" },
  { title: "Production", subtitle: "Build finished goods from a BOM", route: "ProductionList" },
  { title: "Shipping", subtitle: "Ship against an open sales order", route: "ShippingList" },
];

export default function HomeScreen({ navigation }: Props) {
  const { state, signOut } = useAuth();
  const org = state.status === "signedIn" ? state.org : null;
  const user = state.status === "signedIn" ? state.user : null;

  return (
    <Screen>
      <View style={{ marginBottom: spacing.lg }}>
        <Text style={{ fontSize: 22, fontWeight: "700", color: colors.text }}>{org?.name}</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.xs }}>Signed in as {user?.name}</Text>
      </View>
      {TILES.map((tile) => (
        <Pressable key={tile.route} onPress={() => navigation.navigate(tile.route as any)}>
          <Card>
            <Text style={{ fontSize: 17, fontWeight: "600", color: colors.text }}>{tile.title}</Text>
            <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.xs }}>{tile.subtitle}</Text>
          </Card>
        </Pressable>
      ))}
      <Pressable onPress={signOut} style={{ marginTop: spacing.md, alignItems: "center" }}>
        <Text style={{ color: colors.textMuted }}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}
