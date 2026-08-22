import React, { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { listBoms } from "../../api/inventory";
import { ApiError } from "../../api/client";
import { Card, EmptyState, ErrorBanner, Loading, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";
import type { BomSummary } from "../../api/types";

type Props = NativeStackScreenProps<RootStackParamList, "ProductionList">;

export default function ProductionListScreen({ navigation }: Props) {
  const [boms, setBoms] = useState<BomSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setBoms(await listBoms());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load bills of material.");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (boms === null && !error) return <Loading />;

  const active = (boms ?? []).filter((b) => b.status === "Active" && b.outputItemId && b.inputCount > 0);

  return (
    <Screen>
      <ErrorBanner message={error} />
      <FlatList
        data={active}
        keyExtractor={(b) => b.id}
        ListEmptyComponent={<EmptyState message="No active bills of material with inputs configured." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("ProductionDetail", { bom: item })}>
            <Card>
              <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{item.name}</Text>
              <Text style={{ fontSize: 14, color: colors.textMuted, marginTop: spacing.xs }}>
                Produces {item.outputItemName ?? "—"}
              </Text>
              <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: spacing.xs }}>
                {item.inputCount} input{item.inputCount === 1 ? "" : "s"} · batch size {item.batchSize}
              </Text>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
