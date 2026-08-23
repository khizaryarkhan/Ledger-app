import React, { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { listOpenPos } from "../../api/inventory";
import { ApiError } from "../../api/client";
import { Button, Card, EmptyState, ErrorBanner, Loading, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";
import type { OpenPo } from "../../api/types";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivingList">;

export default function ReceivingListScreen({ navigation }: Props) {
  const [pos, setPos] = useState<OpenPo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setPos(await listOpenPos());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load open purchase orders.");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (pos === null && !error) return <Loading />;

  return (
    <Screen>
      <ErrorBanner message={error} />
      <Button
        title="Receive without a PO"
        variant="secondary"
        onPress={() => navigation.navigate("ReceivingAdHoc")}
      />
      <View style={{ height: spacing.md }} />
      <FlatList
        data={pos ?? []}
        keyExtractor={(po) => po.id}
        ListEmptyComponent={<EmptyState message="No open purchase orders with stock still due. Stock can still be received without one." />}
        renderItem={({ item }) => {
          const remainingLines = item.lines.filter((l) => l.remainingQty > 0.0001);
          return (
            <Pressable onPress={() => navigation.navigate("ReceivingDetail", { po: item })}>
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{item.docNumber}</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted }}>{item.issueDate}</Text>
                </View>
                <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.xs }}>
                  {item.partyLabel ?? "Unknown supplier"}
                </Text>
                <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: spacing.xs }}>
                  {remainingLines.length} line{remainingLines.length === 1 ? "" : "s"} awaiting receipt
                </Text>
              </Card>
            </Pressable>
          );
        }}
      />
    </Screen>
  );
}
