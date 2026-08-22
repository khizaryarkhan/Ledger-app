import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { postGoodsReceipt } from "../../api/inventory";
import { ApiError } from "../../api/client";
import { Button, Card, ErrorBanner, Field, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivingDetail">;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ReceivingDetailScreen({ route, navigation }: Props) {
  const { po } = route.params;
  const openLines = useMemo(() => po.lines.filter((l) => l.remainingQty > 0.0001), [po]);

  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(openLines.map((l) => [l.lineId, String(l.remainingQty)])),
  );
  const [lotNo, setLotNo] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
  const [receiptDate, setReceiptDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    const lines = openLines
      .map((l) => {
        const q = parseFloat(qty[l.lineId] ?? "0");
        if (!q || q <= 0) return null;
        return {
          itemId: l.itemId,
          poId: po.id,
          poLineId: l.lineId,
          qtyBase: q,
          unitCost: l.unitCostBase,
          lotNo: lotNo[l.lineId] || null,
          expiryDate: expiry[l.lineId] || null,
        };
      })
      .filter(Boolean) as any[];

    if (lines.length === 0) {
      setError("Enter a quantity for at least one line.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await postGoodsReceipt({
        supplierId: po.partyId,
        supplierLabel: po.partyLabel,
        receiptDate,
        currency: po.currency,
        exchangeRate: po.exchangeRate,
        notes: notes || null,
        lines,
      });
      setDone(result.receiptNo);
      setTimeout(() => navigation.navigate("ReceivingList"), 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not post the goods receipt.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{po.docNumber}</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg }}>
          {po.partyLabel ?? "Unknown supplier"}
        </Text>

        <ErrorBanner message={error} />
        {done && (
          <View style={{ backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", borderWidth: 1, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md }}>
            <Text style={{ color: colors.success }}>Goods receipt {done} posted.</Text>
          </View>
        )}

        {openLines.map((line) => (
          <Card key={line.lineId}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{line.itemName}</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm }}>
              Ordered {line.orderedBaseQty} {line.baseUom} · Received {line.receivedQty} · Remaining {line.remainingQty}
            </Text>
            <Field
              label={`Quantity received (${line.baseUom})`}
              value={qty[line.lineId]}
              onChangeText={(v) => setQty((s) => ({ ...s, [line.lineId]: v }))}
              keyboardType="decimal-pad"
            />
            <Field
              label="Lot / batch number (optional)"
              value={lotNo[line.lineId] ?? ""}
              onChangeText={(v) => setLotNo((s) => ({ ...s, [line.lineId]: v }))}
            />
            <Field
              label="Expiry date, YYYY-MM-DD (optional)"
              value={expiry[line.lineId] ?? ""}
              onChangeText={(v) => setExpiry((s) => ({ ...s, [line.lineId]: v }))}
              placeholder="2027-01-31"
            />
          </Card>
        ))}

        <Card>
          <Field label="Receipt date" value={receiptDate} onChangeText={setReceiptDate} placeholder="YYYY-MM-DD" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </Card>

        <Button title="Post goods receipt" onPress={onSubmit} loading={submitting} disabled={!!done} />
      </Screen>
    </ScrollView>
  );
}
