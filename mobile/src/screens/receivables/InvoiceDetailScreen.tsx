import React, { useCallback, useEffect, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import {
  getInvoiceDetail, logPromise, raiseDispute, clearResponse, addInvoiceNote, setInvoiceStage, getArSummary,
} from "../../api/receivables";
import { shareInvoicePdf } from "../../api/pdf";
import { ApiError } from "../../api/client";
import { DISPUTE_CATEGORIES, type InvoiceDetail } from "../../api/types";
import {
  Button, Callout, Card, ErrorBanner, Field, KeyValue, Loading, PickerModal, Pill, Screen,
  SectionTitle, SuccessBanner,
} from "../../components/ui";
import { dateTime, endOfMonthIso, isoInDays, money, overdueLabel, shortDate, todayIso } from "../../format";
import { colors, spacing } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivablesInvoiceDetail">;

type Sheet = null | "promise" | "dispute" | "note";

export default function InvoiceDetailScreen({ navigation, route }: Props) {
  const { invoiceId, invoiceNumber } = route.params;

  const [data, setData] = useState<InvoiceDetail | null>(null);
  const [stageOptions, setStageOptions] = useState<{ key: string; label: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [stagePickerOpen, setStagePickerOpen] = useState(false);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);

  // Sheet drafts
  const [promiseDate, setPromiseDate] = useState(isoInDays(7));
  const [promiseAmount, setPromiseAmount] = useState("");
  const [promiseNote, setPromiseNote] = useState("");
  const [disputeCategory, setDisputeCategory] = useState<string>(DISPUTE_CATEGORIES[0]);
  const [disputeReason, setDisputeReason] = useState("");
  const [noteText, setNoteText] = useState("");

  useEffect(() => {
    if (invoiceNumber) navigation.setOptions({ title: invoiceNumber });
  }, [invoiceNumber, navigation]);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await getInvoiceDetail(invoiceId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not load this invoice.");
    }
  }, [invoiceId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // The stage list is the org's own (renames included), so it's fetched rather
  // than hard-coded. Failing to get it only costs the stage editor, not the screen.
  useEffect(() => {
    getArSummary().then(s => setStageOptions(s.stageOptions.map(o => ({ key: o.key, label: o.label })))).catch(() => {});
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  /** Every action follows the same shape: run, report, reload, close. */
  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(label);
      setSheet(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't save. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [load]);

  if (data === null) {
    if (!error) return <Loading />;
    return (
      <Screen>
        <ErrorBanner message={error} />
        <Button title="Try again" variant="secondary" onPress={load} />
      </Screen>
    );
  }

  const inv = data.invoice;
  const canAct = inv.isOpen && !inv.isCreditMemo;
  const hasResponse = !!inv.promiseDate || !!inv.disputeReason || data.disputes.some(d => d.status === "Open" || d.status === "Under Review");
  const primaryContact = data.contacts.find(c => c.isPrimary) ?? data.contacts[0] ?? null;

  return (
    <Screen>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />}
      >
        <ErrorBanner message={error} />
        <SuccessBanner message={notice} />

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <Card>
          <Text style={{ fontSize: 18, fontWeight: "700", color: colors.text }}>{inv.customerName}</Text>
          <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }}>
            {inv.invoiceNumber}{inv.projectName ? ` · ${inv.projectName}` : ""}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginTop: spacing.lg }}>
            <View>
              <Text style={{ fontSize: 10, fontWeight: "700", letterSpacing: 0.6, color: colors.textMuted }}>OUTSTANDING</Text>
              <Text style={{
                fontSize: 28, fontWeight: "700", marginTop: 2,
                color: inv.daysOverdue > 0 && inv.isOpen ? colors.danger : colors.text,
              }}>
                {money(inv.balance, inv.currency)}
              </Text>
            </View>
            <Pressable onPress={() => canAct && stageOptions.length > 0 && setStagePickerOpen(true)} hitSlop={8}>
              <Pill label={inv.stageLabel} tone={inv.stage === "Escalated" ? "warn" : "neutral"} />
            </Pressable>
          </View>

          <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: spacing.lg }}>
            <KeyValue label="Invoice total" value={money(inv.total, inv.currency)} />
            <KeyValue label="Paid" value={money(inv.paid, inv.currency)} tone={inv.paid > 0 ? "success" : undefined} />
            <KeyValue label="Invoice date" value={shortDate(inv.invoiceDate)} />
            <KeyValue
              label="Due date"
              value={`${shortDate(inv.dueDate)}${inv.isOpen ? ` · ${overdueLabel(inv.daysOverdue)}` : ""}`}
              tone={inv.isOpen && inv.daysOverdue > 0 ? "danger" : undefined}
            />
            <KeyValue label="Status" value={inv.paymentStatus} />
            {inv.poNumber ? <KeyValue label="Customer PO" value={inv.poNumber} /> : null}
          </View>
        </Card>

        {/* ── Current state ───────────────────────────────────────────────── */}
        {inv.promiseBroken ? (
          <Callout tone="danger" title={`Broken commitment — was due ${shortDate(inv.promiseDate)}`}
            body="The promised date has passed without payment. Time to chase again." />
        ) : inv.promiseDate ? (
          <Callout tone="promise" title={`Committed to pay by ${shortDate(inv.promiseDate)}`} />
        ) : null}
        {inv.disputeReason ? <Callout tone="dispute" title="Disputed" body={inv.disputeReason} /> : null}
        {inv.escalatedToName ? (
          <Callout tone="warn" title={`Escalated to ${inv.escalatedToName}`} body={inv.escalatedToEmail} />
        ) : null}

        {/* ── Contact ─────────────────────────────────────────────────────── */}
        {primaryContact || inv.customerEmail ? (
          <>
            <SectionTitle title="Contact" />
            <Card>
              <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>
                {primaryContact?.name ?? inv.customerName}
              </Text>
              <View style={{ flexDirection: "row", gap: spacing.sm, marginTop: spacing.md }}>
                {primaryContact?.phone ? (
                  <View style={{ flex: 1 }}>
                    <Button title="Call" variant="secondary" onPress={() => Linking.openURL(`tel:${primaryContact.phone}`)} />
                  </View>
                ) : null}
                {(primaryContact?.email ?? inv.customerEmail) ? (
                  <View style={{ flex: 1 }}>
                    <Button
                      title="Email"
                      variant="secondary"
                      onPress={() => Linking.openURL(
                        `mailto:${primaryContact?.email ?? inv.customerEmail}?subject=${encodeURIComponent(`Invoice ${inv.invoiceNumber}`)}`,
                      )}
                    />
                  </View>
                ) : null}
              </View>
            </Card>
          </>
        ) : null}

        {/* ── Actions ─────────────────────────────────────────────────────── */}
        {canAct ? (
          <>
            <SectionTitle title="Log an outcome" />
            <View style={{ flexDirection: "row", gap: spacing.sm, marginBottom: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Commitment" onPress={() => setSheet(s => s === "promise" ? null : "promise")} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Dispute" variant="secondary" onPress={() => setSheet(s => s === "dispute" ? null : "dispute")} />
              </View>
            </View>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <View style={{ flex: 1 }}>
                <Button title="Add note" variant="secondary" onPress={() => setSheet(s => s === "note" ? null : "note")} />
              </View>
              {hasResponse ? (
                <View style={{ flex: 1 }}>
                  <Button
                    title="Clear response"
                    variant="secondary"
                    onPress={() => Alert.alert(
                      "Clear response?",
                      "Removes the open commitment or dispute and returns the invoice to its previous stage.",
                      [
                        { text: "Cancel", style: "cancel" },
                        { text: "Clear", style: "destructive", onPress: () => run("Response cleared.", () => clearResponse(invoiceId)) },
                      ],
                    )}
                  />
                </View>
              ) : null}
            </View>

            {sheet === "promise" ? (
              <Card style={{ marginTop: spacing.md, borderColor: colors.promise }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.promise, marginBottom: spacing.md }}>
                  Customer promised to pay…
                </Text>
                <DateChips value={promiseDate} onChange={setPromiseDate} />
                <Field label="Promised date" value={promiseDate} onChangeText={setPromiseDate} placeholder="YYYY-MM-DD" autoCapitalize="none" />
                <Field
                  label="Amount (blank = full balance)"
                  value={promiseAmount}
                  onChangeText={setPromiseAmount}
                  placeholder={money(inv.balance, inv.currency)}
                  keyboardType="decimal-pad"
                />
                <Field label="Note" value={promiseNote} onChangeText={setPromiseNote} placeholder="e.g. spoke to John in accounts" />
                <Button
                  title="Save commitment"
                  loading={saving}
                  disabled={!/^\d{4}-\d{2}-\d{2}$/.test(promiseDate)}
                  onPress={() => run("Commitment logged.", async () => {
                    await logPromise(invoiceId, {
                      promiseDate,
                      amount: promiseAmount.trim() ? Number(promiseAmount) : null,
                      note: promiseNote.trim() || null,
                    });
                    setPromiseAmount(""); setPromiseNote("");
                  })}
                />
              </Card>
            ) : null}

            {sheet === "dispute" ? (
              <Card style={{ marginTop: spacing.md, borderColor: colors.dispute }}>
                <Text style={{ fontSize: 13, fontWeight: "700", color: colors.dispute, marginBottom: spacing.md }}>
                  Customer raised a query…
                </Text>
                <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textMuted, marginBottom: spacing.xs }}>Category</Text>
                <Pressable onPress={() => setCategoryPickerOpen(true)} style={{ marginBottom: spacing.md }}>
                  <View style={{
                    borderWidth: 1, borderColor: colors.border, borderRadius: 8,
                    paddingHorizontal: spacing.md, paddingVertical: spacing.md, backgroundColor: colors.card,
                  }}>
                    <Text style={{ fontSize: 16, color: colors.text }}>{disputeCategory}</Text>
                  </View>
                </Pressable>
                <Field
                  label="What's the issue?"
                  value={disputeReason}
                  onChangeText={setDisputeReason}
                  placeholder="Detail the customer's query"
                  multiline
                  numberOfLines={3}
                />
                <Button
                  title="Raise dispute"
                  loading={saving}
                  onPress={() => run("Dispute raised.", async () => {
                    await raiseDispute(invoiceId, { category: disputeCategory, reason: disputeReason.trim() || null });
                    setDisputeReason("");
                  })}
                />
              </Card>
            ) : null}

            {sheet === "note" ? (
              <Card style={{ marginTop: spacing.md }}>
                <Field
                  label="Internal note"
                  value={noteText}
                  onChangeText={setNoteText}
                  placeholder="What happened on this account?"
                  multiline
                  numberOfLines={3}
                />
                <Button
                  title="Save note"
                  loading={saving}
                  disabled={!noteText.trim()}
                  onPress={() => run("Note added.", async () => {
                    await addInvoiceNote(invoiceId, noteText.trim());
                    setNoteText("");
                  })}
                />
              </Card>
            ) : null}
          </>
        ) : null}

        {inv.hasPdf ? (
          <View style={{ marginTop: spacing.md }}>
            <Button
              title="Share invoice PDF"
              variant="secondary"
              onPress={async () => {
                try {
                  await shareInvoicePdf(inv.id, inv.invoiceNumber);
                } catch (e: any) {
                  setError(e?.message || "Could not fetch the PDF.");
                }
              }}
            />
          </View>
        ) : null}

        {/* ── History ─────────────────────────────────────────────────────── */}
        {data.promises.length ? (
          <>
            <SectionTitle title="Commitments" />
            <Card>
              {data.promises.map((p, i) => (
                <View key={p.id} style={{ paddingVertical: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{shortDate(p.promiseDate)}</Text>
                    <Pill label={p.status} tone={p.status === "Kept" ? "success" : p.status === "Broken" ? "danger" : "promise"} />
                  </View>
                  <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 2 }}>
                    {p.amount != null ? `${money(p.amount, inv.currency)} · ` : ""}via {p.source}
                  </Text>
                  {p.note ? <Text style={{ fontSize: 13, color: colors.text, marginTop: 4 }}>{p.note}</Text> : null}
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {data.disputes.length ? (
          <>
            <SectionTitle title="Disputes" />
            <Card>
              {data.disputes.map((d, i) => (
                <View key={d.id} style={{ paddingVertical: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                    <Text style={{ fontSize: 14, fontWeight: "600", color: colors.text }}>{d.category}</Text>
                    <Pill label={d.status} tone={d.status === "Resolved" ? "success" : "dispute"} />
                  </View>
                  {d.reason ? <Text style={{ fontSize: 13, color: colors.text, marginTop: 4 }}>{d.reason}</Text> : null}
                  {d.resolution ? (
                    <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 4 }}>Resolution: {d.resolution}</Text>
                  ) : null}
                  <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 4 }}>
                    Raised {dateTime(d.createdAt)} · via {d.source}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionTitle title="Activity" />
        {data.activity.length === 0 ? (
          <Card><Text style={{ fontSize: 13, color: colors.textMuted }}>Nothing logged on this invoice yet.</Text></Card>
        ) : (
          <Card>
            {data.activity.map((a, i) => (
              <View key={a.id} style={{ paddingVertical: spacing.sm, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.border }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                  <Text style={{ fontSize: 13, fontWeight: "600", color: colors.text }}>
                    {a.channel}{a.direction === "Inbound" ? " · reply" : ""}
                  </Text>
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>{dateTime(a.sentAt)}</Text>
                </View>
                <Text style={{ fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  {a.authorName ?? a.sender ?? "System"}
                </Text>
                {a.subject ? <Text style={{ fontSize: 13, color: colors.text, marginTop: 4 }}>{a.subject}</Text> : null}
                {a.body ? (
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 2 }} numberOfLines={6}>{a.body}</Text>
                ) : null}
              </View>
            ))}
          </Card>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>

      <PickerModal
        visible={stagePickerOpen}
        title="Move to stage"
        items={stageOptions}
        keyOf={(s) => s.key}
        labelOf={(s) => s.label}
        onClose={() => setStagePickerOpen(false)}
        onSelect={(s) => {
          setStagePickerOpen(false);
          if (s.key !== inv.stage) run(`Moved to ${s.label}.`, () => setInvoiceStage(invoiceId, s.key));
        }}
      />

      <PickerModal
        visible={categoryPickerOpen}
        title="Dispute category"
        items={DISPUTE_CATEGORIES.map(c => ({ key: c, label: c }))}
        keyOf={(c) => c.key}
        labelOf={(c) => c.label}
        onClose={() => setCategoryPickerOpen(false)}
        onSelect={(c) => { setDisputeCategory(c.key); setCategoryPickerOpen(false); }}
      />
    </Screen>
  );
}

/**
 * Promise dates are almost always "in a few days", so offer those directly —
 * typing YYYY-MM-DD on a phone while on a call is the slowest possible path.
 * The text field stays, for the date that isn't one of these.
 */
function DateChips({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  const options = [
    { label: "Today", iso: todayIso() },
    { label: "3 days", iso: isoInDays(3) },
    { label: "1 week", iso: isoInDays(7) },
    { label: "2 weeks", iso: isoInDays(14) },
    { label: "Month end", iso: endOfMonthIso() },
  ];
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.md }}>
      {options.map(o => {
        const active = o.iso === value;
        return (
          <Pressable
            key={o.label}
            onPress={() => onChange(o.iso)}
            style={{
              paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: 999, borderWidth: 1,
              borderColor: active ? colors.promise : colors.border,
              backgroundColor: active ? colors.promiseBg : colors.card,
            }}
          >
            <Text style={{ fontSize: 12, fontWeight: "600", color: active ? colors.promise : colors.textMuted }}>
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
