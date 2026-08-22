import React, { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { listOpenSos } from "../../api/inventory";
import { ApiError } from "../../api/client";
import { Card, EmptyState, ErrorBanner, Loading, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";
import type { OpenSo } from "../../api/types";

type Props = NativeStackScreenProps<RootStackParamList, "ShippingList">;

export default function ShippingListScreen({ navigation }: Props) {
  const [sos, setSos] = useState<OpenSo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSos(await listOpenSos());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load open sales orders.");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (sos === null && !error) return <Loading />;

  return (
    <Screen>
      <ErrorBanner message={error} />
      <FlatList
        data={sos ?? []}
        keyExtractor={(so) => so.id}
        ListEmptyComponent={<EmptyState message="No open sales orders with stock still to ship." />}
        renderItem={({ item }) => {
          const remainingLines = item.lines.filter((l) => l.remainingQty > 0.0001);
          return (
            <Pressable onPress={() => navigation.navigate("ShippingDetail", { so: item })}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{item.docNumber}</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted }}>{item.issueDate}</Text>
                </View>
                <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.xs }}>
                  {item.partyLabel ?? "Unknown customer"}
                </Text>
                <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: spacing.xs }}>
                  {remainingLines.length} line{remainingLines.length === 1 ? "" : "s"} awaiting shipment
                </Text>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
