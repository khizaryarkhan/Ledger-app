import React, { useCallback, useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { listReceivableInvoices } from "../../api/receivables";
import { ApiError } from "../../api/client";
import type { ReceivableInvoice } from "../../api/types";
import { Card, EmptyState, ErrorBanner, Loading, Pill, Screen, SearchBar, Segmented } from "../../components/ui";
import { money, overdueLabel, shortDate } from "../../format";
import { colors, spacing } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivablesInvoices">;

const FILTERS = [
  { key: "open", label: "Open" },
  { key: "overdue", label: "Overdue" },
  { key: "promised", label: "Committed" },
  { key: "disputed", label: "Disputed" },
  { key: "escalated", label: "Escalated" },
  { key: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

/**
 * The working list. Filtering and searching happen on the server (see
 * app/api/mobile/receivables/invoices) so a rep on mobile data downloads their
 * slice rather than the org's whole ledger.
 */
export default function InvoiceListScreen({ navigation, route }: Props) {
  const customerId = route.params?.customerId;
  const customerName = route.params?.customerName;

  const [filter, setFilter] = useState<FilterKey>((route.params?.filter as FilterKey) ?? "open");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [invoices, setInvoices] = useState<ReceivableInvoice[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (customerName) navigation.setOptions({ title: customerName });
  }, [customerName, navigation]);

  // Typing shouldn't fire a request per keystroke over a mobile connection.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), 300);
    return () => clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await listReceivableInvoices({ filter, q: debounced || undefined, customerId });
      setInvoices(res.invoices);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load invoices.");
    }
  }, [filter, debounced, customerId]);

  // Reloads on focus too, so returning from the detail screen shows the promise
  // or dispute just logged rather than a stale row.
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const outstanding = (invoices ?? []).reduce((s, i) => s + (i.isOpen ? i.balance : 0), 0);

  return (
    <Screen>
      <Segmented options={FILTERS.map(f => ({ key: f.key, label: f.label }))} value={filter} onChange={setFilter} />
      <SearchBar value={query} onChangeText={setQuery} placeholder="Invoice no., customer or project…" />
      <ErrorBanner message={error} />

      {invoices === null && !error ? (
        <Loading />
      ) : (
        <FlatList
          data={invoices ?? []}
          keyExtractor={(i) => i.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
          ListHeaderComponent={
            (invoices ?? []).length ? (
              <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm }}>
                {total} invoice{total === 1 ? "" : "s"} · {money(outstanding, invoices?.[0]?.currency)} outstanding
              </Text>
            ) : null
          }
          ListEmptyComponent={<EmptyState message="Nothing here. Try another filter or clear the search." />}
          renderItem={({ item }) => <InvoiceRow inv={item} onPress={() =>
            navigation.navigate("ReceivablesInvoiceDetail", { invoiceId: item.id, invoiceNumber: item.invoiceNumber })} />}
        />
      )}
    </Screen>
  );
}

/**
 * One row. The pills carry the state a rep decides on: a broken commitment is
 * called out in red rather than shown as "Committed", exactly as the board does
 * — the difference between "they promised" and "they promised and missed it" is
 * the whole point of the row.
 */
export function InvoiceRow({ inv, onPress }: { inv: ReceivableInvoice; onPress: () => void }) {
  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: spacing.sm }}>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
          <View style={{ flex: 1, paddingRight: spacing.md }}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }} numberOfLines={1}>
              {inv.customerName}
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }} numberOfLines={1}>
              {inv.invoiceNumber}{inv.projectName ? ` · ${inv.projectName}` : ""}
            </Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{
              fontSize: 16, fontWeight: "700",
              color: inv.daysOverdue > 0 && inv.isOpen ? colors.danger : colors.text,
            }}>
              {money(inv.balance, inv.currency)}
            </Text>
            <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
              {shortDate(inv.dueDate)}
            </Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.sm }}>
          {inv.isOpen && inv.daysOverdue > 0 ? <Pill label={overdueLabel(inv.daysOverdue)} tone="danger" /> : null}
          {inv.hasOpenDispute || inv.disputeReason
            ? <Pill label={`Disputed${inv.disputeReason ? ` · ${inv.disputeReason}` : ""}`} tone="dispute" />
            : inv.promiseBroken
              ? <Pill label={`Broken commitment · ${shortDate(inv.promiseDate)}`} tone="danger" />
              : inv.promiseDate
                ? <Pill label={`Committed · ${shortDate(inv.promiseDate)}`} tone="promise" />
                : null}
          {inv.escalatedTo ? <Pill label={`→ ${inv.escalatedTo}`} tone="warn" /> : null}
          {!inv.isOpen ? <Pill label={inv.paymentStatus} tone="success" /> : <Pill label={inv.stageLabel} />}
        </View>
      </Card>
    </Pressable>
  );
}
