import React, { useCallback, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { getArSummary } from "../../api/receivables";
import { ApiError } from "../../api/client";
import type { ArSummary } from "../../api/types";
import { AgingBar, Card, ErrorBanner, Loading, Pill, Screen, SectionTitle, Stat } from "../../components/ui";
import { money } from "../../format";
import { colors, spacing } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivablesOverview">;

/**
 * The rep's book at a glance — the summary banner from the web portal, plus
 * the shortcuts that follow from it. Every figure is a tap-through: a rep who
 * sees "12 overdue" should reach those twelve invoices without hunting for a
 * filter.
 */
export default function ReceivablesOverviewScreen({ navigation }: Props) {
  const [data, setData] = useState<ArSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getArSummary());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load your receivables.");
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  if (data === null && !error) return <Loading />;

  const t = data?.totals;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ErrorBanner message={error} />

        {data ? (
          <>
            <Card>
              {/* An admin sees the whole org; a rep sees their own book. Saying
                  which avoids a rep wondering why a colleague's figure differs. */}
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md }}>
                <Text style={{ fontSize: 13, color: colors.textMuted }}>
                  {data.scoped ? data.rep?.name ?? "Your book" : "Whole organisation"}
                </Text>
                {data.scoped && data.rep ? <Pill label={data.rep.tier.toUpperCase()} /> : <Pill label="ALL" tone="success" />}
              </View>

              <View style={{ flexDirection: "row", gap: spacing.md }}>
                <Stat
                  label="Total AR"
                  value={money(t?.totalAR ?? 0)}
                  sub={`${t?.openCount ?? 0} open invoice${t?.openCount === 1 ? "" : "s"}`}
                />
                <Stat
                  label="Overdue"
                  value={money(t?.overdueAR ?? 0)}
                  sub={`${t?.overdueCount ?? 0} invoice${t?.overdueCount === 1 ? "" : "s"}`}
                  tone={(t?.overdueAR ?? 0) > 0 ? "danger" : "default"}
                />
              </View>

              {(t?.unappliedCredits ?? 0) > 0 ? (
                <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: spacing.md }}>
                  Net of {money(t!.unappliedCredits)} in unapplied credit notes.
                </Text>
              ) : null}

              <AgingBar buckets={data.aging} />
            </Card>

            <SectionTitle title="Work the book" />
            {[
              { key: "overdue", title: "Overdue", subtitle: "Past the due date — chase these first" },
              { key: "promised", title: "Committed", subtitle: "Customer promised to pay" },
              { key: "disputed", title: "Disputed", subtitle: "Queries blocking payment" },
              { key: "open", title: "All open", subtitle: "Everything still outstanding" },
            ].map(f => (
              <Pressable key={f.key} onPress={() => navigation.navigate("ReceivablesInvoices", { filter: f.key })}>
                <Card style={{ marginBottom: spacing.sm }}>
                  <Text style={{ fontSize: 16, fontWeight: "600", color: colors.text }}>{f.title}</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>{f.subtitle}</Text>
                </Card>
              </Pressable>
            ))}

            {data.stages.length ? (
              <>
                <SectionTitle title="By stage" />
                <Card>
                  {data.stages.map((s, i) => (
                    <View
                      key={s.label}
                      style={{
                        flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                        paddingVertical: spacing.sm,
                        borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border,
                      }}
                    >
                      <Text style={{ fontSize: 14, color: colors.text }}>{s.label}</Text>
                      <Text style={{ fontSize: 14, fontWeight: "700", color: colors.textMuted }}>{s.count}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}

            <View style={{ height: spacing.xl }} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}
