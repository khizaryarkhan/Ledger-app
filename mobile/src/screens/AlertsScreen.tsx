import React, { useCallback, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TabScreenProps } from "../navigation/types";
import { getAlerts } from "../api/receivables";
import { ApiError } from "../api/client";
import type { Alert, AlertFeed } from "../api/types";
import { Card, EmptyState, ErrorBanner, Loading, Screen, Segmented } from "../components/ui";
import { dateTime, money } from "../format";
import { colors, spacing } from "../theme";

type Props = TabScreenProps<"AlertsTab">;

const FILTERS = [
  { key: "needs", label: "Needs action" },
  { key: "all", label: "Everything" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const ICONS: Record<Alert["kind"], string> = {
  reply: "mail-unread-outline",
  dispute: "alert-circle-outline",
  broken: "close-circle-outline",
  escalation: "arrow-up-circle-outline",
};

const TONE_COLORS: Record<Alert["tone"], string> = {
  promise: colors.promise,
  dispute: colors.dispute,
  danger: colors.danger,
  warn: colors.warn,
};

/**
 * What changed on your book that you didn't do yourself.
 *
 * There's no push channel and no per-user read state yet, so this is derived
 * from real records — customer replies, disputes raised, commitments missed,
 * invoices escalated to you — rather than from a notifications table. Nothing
 * is invented: every row points at the invoice that caused it.
 */
export default function AlertsScreen({ navigation }: Props) {
  const [feed, setFeed] = useState<AlertFeed | null>(null);
  const [filter, setFilter] = useState<FilterKey>("needs");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFeed(await getAlerts());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your alerts.");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (feed === null && !error) return <Loading />;

  const shown = (feed?.alerts ?? []).filter(a => filter === "all" || a.actionable);

  return (
    <Screen>
      <Segmented options={FILTERS.map(f => ({ key: f.key, label: f.label }))} value={filter} onChange={setFilter} />
      <ErrorBanner message={error} />
      <FlatList
        data={shown}
        keyExtractor={(a) => a.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListEmptyComponent={
          <EmptyState message={filter === "needs"
            ? "Nothing needs your attention. Switch to Everything for the full history."
            : "No activity on your book in the last 30 days."} />
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("ReceivablesInvoiceDetail", {
            invoiceId: item.invoiceId, invoiceNumber: item.invoiceNumber,
          })}>
            <Card style={{ marginBottom: spacing.sm, flexDirection: "row" }}>
              <View style={{
                width: 34, height: 34, borderRadius: 17, backgroundColor: colors.cardMuted,
                alignItems: "center", justifyContent: "center", marginRight: spacing.md,
              }}>
                <Ionicons name={ICONS[item.kind] as any} size={18} color={TONE_COLORS[item.tone]} />
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <Text style={{ flex: 1, fontSize: 14, fontWeight: "600", color: TONE_COLORS[item.tone] }} numberOfLines={1}>
                    {item.title}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginLeft: spacing.sm }}>
                    {dateTime(item.at)}
                  </Text>
                </View>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text, marginTop: 3 }} numberOfLines={1}>
                  {item.customerName}
                </Text>
                {item.body ? (
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }} numberOfLines={3}>{item.body}</Text>
                ) : null}
                <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                  {item.invoiceNumber} · {money(item.balance, item.currency)} outstanding
                </Text>
              </View>
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
