import React, { useCallback, useMemo, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { listReceivableCustomers } from "../../api/receivables";
import { ApiError } from "../../api/client";
import type { ReceivableCustomer } from "../../api/types";
import { Card, EmptyState, ErrorBanner, Loading, Pill, Screen, SearchBar } from "../../components/ui";
import { money } from "../../format";
import { colors, spacing } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivablesCustomers">;

/**
 * Customers rolled up by open balance — the portal's entity cards, worst first.
 * A customer appears because they have visible open invoices, which is what
 * makes this work for customer-level, project-level and mixed rep assignment
 * alike (see lib/receivables/rep-scope).
 */
export default function ReceivableCustomersScreen({ navigation }: Props) {
  const [customers, setCustomers] = useState<ReceivableCustomer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setCustomers((await listReceivableCustomers()).customers);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your customers.");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  // Small list, already downloaded — filtering here beats a round trip.
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return customers ?? [];
    return (customers ?? []).filter(c =>
      c.name.toLowerCase().includes(needle) || (c.code ?? "").toLowerCase().includes(needle));
  }, [customers, query]);

  if (customers === null && !error) return <Loading />;

  const totalOpen = (customers ?? []).reduce((s, c) => s + c.balance, 0);

  return (
    <Screen>
      <SearchBar value={query} onChangeText={setQuery} placeholder="Search customers…" />
      <ErrorBanner message={error} />
      <FlatList
        data={shown}
        keyExtractor={(c) => c.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
        ListHeaderComponent={
          (customers ?? []).length ? (
            <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
              {customers!.length} customer{customers!.length === 1 ? "" : "s"} · {money(totalOpen, customers![0]?.currency)} outstanding
            </Text>
          ) : null
        }
        ListEmptyComponent={<EmptyState message="No customers with an open balance." />}
        renderItem={({ item }) => (
          <Pressable onPress={() => navigation.navigate("ReceivablesInvoices", {
            customerId: item.id, customerName: item.name, filter: "open",
          })}>
            <Card style={{ marginBottom: spacing.sm }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: spacing.md }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }} numberOfLines={1}>{item.name}</Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                    {item.openCount} open invoice{item.openCount === 1 ? "" : "s"}
                    {item.code ? ` · ${item.code}` : ""}
                  </Text>
                </View>
                <Text style={{ fontSize: 16, fontWeight: "700", color: item.overdue > 0 ? colors.danger : colors.text }}>
                  {money(item.balance, item.currency)}
                </Text>
              </View>
              {item.overdue > 0 ? (
                <View style={{ flexDirection: "row", gap: spacing.xs, marginTop: spacing.sm }}>
                  <Pill label={`${money(item.overdue, item.currency)} overdue`} tone="danger" />
                  <Pill label={`Oldest ${item.oldestDays}d`} />
                </View>
              ) : null}
            </Card>
          </Pressable>
        )}
      />
    </Screen>
  );
}
