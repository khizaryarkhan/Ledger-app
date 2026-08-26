import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { listEscalations } from "../../api/receivables";
import { ApiError } from "../../api/client";
import type { EscalationList } from "../../api/types";
import { Card, EmptyState, ErrorBanner, Loading, Pill, Screen } from "../../components/ui";
import { money, overdueLabel, shortDate } from "../../format";
import { colors, spacing } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivablesEscalations">;

/**
 * Invoices escalated TO the signed-in user — the mobile counterpart of the
 * portal's My Escalations page. Escalation is a named hand-off, so this list is
 * "escalated to me" rather than rep-scoped; tapping through opens the same
 * detail screen, where the note box is how an owner replies.
 */
export default function EscalationsScreen({ navigation }: Props) {
  const [data, setData] = useState<EscalationList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await listEscalations());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your escalations.");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (data === null && !error) return <Loading />;

  return (
    <Screen>
      <ErrorBanner message={error} />
      <FlatList
        data={data?.invoices ?? []}
        keyExtractor={(i) => i.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListHeaderComponent={
          data && data.count > 0 ? (
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
              {data.count} invoice{data.count === 1 ? "" : "s"} · {money(data.total, data.invoices[0]?.currency)} outstanding
            </Text>
          ) : null
        }
        ListEmptyComponent={<EmptyState message="Nothing is escalated to you right now." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("ReceivablesInvoiceDetail", { invoiceId: item.id, invoiceNumber: item.invoiceNumber })}>
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }} numberOfLines={1}>{item.customerName}</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
                    {item.invoiceNumber}{item.projectName ? ` · ${item.projectName}` : ""}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={{ fontSize: 16, fontWeight: "700", color: item.daysOverdue > 0 ? colors.danger : colors.text }}>
                    {money(item.balance, item.currency)}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>{shortDate(item.dueDate)}</Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm }}>
                {item.daysOverdue > 0 ? <Pill label={overdueLabel(item.daysOverdue)} tone="danger" /> : null}
                {item.escalationType ? <Pill label={item.escalationType} tone="warn" /> : null}
                {item.escalatedAt ? <Pill label={`Since ${shortDate(item.escalatedAt)}`} /> : null}
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
