import React, { useMemo, useState } from "react";
import { ScrollView, Text } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { postGoodsReceipt } from "../../api/inventory";
import { ApiError } from "../../api/client";
import { Button, Card, ErrorBanner, Field, Screen, SuccessBanner } from "../../components/ui";
import { LotRows, newLot, type LotEntry } from "../../components/lot-rows";
import { colors, spacing } from "../../theme";
import type { ReceiptLineInput } from "../../api/types";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivingDetail">;

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function ReceivingDetailScreen({ route, navigation }: Props) {
  const { po } = route.params;
  const openLines = useMemo(() => po.lines.filter((l) => l.remainingQty > 0.0001), [po]);

  // Each ordered line starts as a single lot prefilled with the full
  // outstanding quantity; the operator splits it when the delivery arrived as
  // several batches.
  const [lotsByLine, setLotsByLine] = useState<Record<string, LotEntry[]>>(() =>
    Object.fromEntries(openLines.map((l) => [l.lineId, [newLot(String(l.remainingQty))]])),
  );
  const [receiptDate, setReceiptDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onSubmit = async () => {
    setError(null);
    // One receipt line per lot — the backend turns each into its own FIFO cost
    // layer and adds its quantity to the order line's received total.
    const lines: ReceiptLineInput[] = openLines.flatMap((line) =>
      (lotsByLine[line.lineId] ?? []).flatMap((lot) => {
        const qty = parseFloat(lot.qty);
        if (!qty || qty <= 0) return [];
        return [{
          itemId: line.itemId,
          poId: po.id,
          poLineId: line.lineId,
          qtyBase: qty,
          unitCost: line.unitCostBase,
          lotNo: lot.lotNo.trim() || null,
          expiryDate: lot.expiry.trim() || null,
        }];
      }),
    );

    if (lines.length === 0) {
      setError("Enter a quantity for at least one lot.");
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
        notes: notes.trim() || null,
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
    <ScrollView keyboardShouldPersistTaps="handled">
      <Screen>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{po.docNumber}</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg }}>
          {po.partyLabel ?? "Unknown supplier"}
        </Text>

        <ErrorBanner message={error} />
        <SuccessBanner message={done ? `Goods receipt ${done} posted.` : null} />

        {openLines.map((line) => (
          <Card key={line.lineId}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{line.itemName}</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: spacing.md }}>
              Ordered {line.orderedBaseQty} {line.baseUom} · Received {line.receivedQty} · Remaining {line.remainingQty}
            </Text>
            <LotRows
              lots={lotsByLine[line.lineId] ?? []}
              onChange={(lots) => setLotsByLine((s) => ({ ...s, [line.lineId]: lots }))}
              baseUom={line.baseUom}
              remaining={line.remainingQty}
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
