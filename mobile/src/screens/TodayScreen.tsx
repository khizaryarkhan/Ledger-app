import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { TabScreenProps } from "../navigation/types";
import { useAuth } from "../auth/AuthContext";
import { hasDepartment } from "../departments";
import { getTodayQueue } from "../api/receivables";
import { listOpenPos, listOpenSos } from "../api/inventory";
import { ApiError } from "../api/client";
import type { TodayQueue } from "../api/types";
import { Card, EmptyState, ErrorBanner, Loading, Pill, type PillTone } from "../components/ui";
import { InvoiceRow } from "./receivables/InvoiceListScreen";
import { money } from "../format";
import { colors, spacing } from "../theme";

type Props = TabScreenProps<"TodayTab">;

/** How many rows to show per section before "see all". */
const PREVIEW = 3;

type OpsCounts = { pos: number; sos: number };

/**
 * The work queue — what to do next, in the order it matters.
 *
 * The invoice list answers "show me everything matching X"; this answers the
 * question someone actually opens the app with. Priority is decided on the
 * server (broken commitments outrank merely-overdue ones, because somebody
 * already promised and missed), and each invoice appears in exactly one
 * section — a queue that lists the same job four times reads as four jobs.
 */
export default function TodayScreen({ navigation }: Props) {
  const { state } = useAuth();
  const role = state.status === "signedIn" ? state.role : null;
  const showReceivables = hasDepartment(role, "receivables");
  const showOperations = hasDepartment(role, "operations");

  const [queue, setQueue] = useState<TodayQueue | null>(null);
  const [ops, setOps] = useState<OpsCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      // Two departments, two sources — a floor lead sees both halves of their
      // day, a rep only the collections half.
      const [q, pos, sos] = await Promise.all([
        showReceivables ? getTodayQueue() : Promise.resolve(null),
        showOperations ? listOpenPos().catch(() => []) : Promise.resolve([]),
        showOperations ? listOpenSos().catch(() => []) : Promise.resolve([]),
      ]);
      setQueue(q);
      setOps(showOperations ? { pos: pos.length, sos: sos.length } : null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your queue.");
    }
  }, [showReceivables, showOperations]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (queue === null && ops === null && !error) return <Loading />;

  const sections = queue?.sections ?? [];
  const opsWork = (ops?.pos ?? 0) + (ops?.sos ?? 0);
  const nothingToDo = sections.length === 0 && opsWork === 0;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xl }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
    >
      <ErrorBanner message={error} />

      {nothingToDo ? (
        <EmptyState message="Nothing needs you right now. Pull down to re-check." />
      ) : null}

      {showOperations && opsWork > 0 ? (
        <View style={{ marginBottom: spacing.lg }}>
          <Text style={styles_sectionLabel}>ON THE FLOOR</Text>
          {(ops?.pos ?? 0) > 0 ? (
            <OpsTile
              icon="download-outline"
              title={`${ops!.pos} purchase order${ops!.pos === 1 ? "" : "s"} to receive`}
              subtitle="Stock ordered and still expected"
              onPress={() => navigation.navigate("ReceivingList")}
            />
          ) : null}
          {(ops?.sos ?? 0) > 0 ? (
            <OpsTile
              icon="cube-outline"
              title={`${ops!.sos} sales order${ops!.sos === 1 ? "" : "s"} to ship`}
              subtitle="Committed stock awaiting despatch"
              onPress={() => navigation.navigate("ShippingList")}
            />
          ) : null}
        </View>
      ) : null}

      {sections.map((s) => (
        <View key={s.key} style={{ marginBottom: spacing.lg }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={styles_sectionLabel}>{s.title.toUpperCase()}</Text>
            <Pill label={`${s.count} · ${money(s.value, s.invoices[0]?.currency)}`} tone={s.tone as PillTone} />
          </View>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm }}>
            {s.blurb}
          </Text>

          {s.invoices.slice(0, PREVIEW).map((inv) => (
            <InvoiceRow
              key={inv.id}
              inv={inv}
              onPress={() => navigation.navigate("ReceivablesInvoiceDetail", {
                invoiceId: inv.id, invoiceNumber: inv.invoiceNumber,
              })}
            />
          ))}

          {s.count > PREVIEW ? (
            <Pressable onPress={() => navigation.navigate("ReceivablesInvoices", { filter: filterFor(s.key) })}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.accent, paddingVertical: spacing.sm }}>
                See all {s.count} →
              </Text>
            </Pressable>
          ) : null}
        </View>
      ))}
    </ScrollView>
  );
}

/**
 * Which list filter shows the rest of a section. Broken commitments and
 * "committed today" are both promises, so both land on the committed filter —
 * the rows themselves distinguish kept from broken.
 */
function filterFor(sectionKey: string): string {
  switch (sectionKey) {
    case "broken":
    case "dueToday": return "promised";
    case "escalated": return "escalated";
    case "disputed": return "disputed";
    case "overdue": return "overdue";
    default: return "open";
  }
}

function OpsTile({ icon, title, subtitle, onPress }: {
  icon: string; title: string; subtitle: string; onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress}>
      <Card style={{ marginBottom: spacing.sm, flexDirection: "row", alignItems: "center" }}>
        <View style={{
          width: 38, height: 38, borderRadius: 10, backgroundColor: colors.cardMuted,
          alignItems: "center", justifyContent: "center", marginRight: spacing.md,
        }}>
          <Ionicons name={icon as any} size={19} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{title}</Text>
          <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </Card>
    </Pressable>
  );
}

const styles_sectionLabel = {
  fontSize: 11, fontWeight: "700" as const, letterSpacing: 0.7, color: colors.textMuted,
};
