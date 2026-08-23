import React, { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { listItems, postGoodsReceipt } from "../../api/inventory";
import { ApiError } from "../../api/client";
import {
  Button, Card, EmptyState, ErrorBanner, Field, Loading, PickerModal, Screen, SuccessBanner,
} from "../../components/ui";
import { LotRows, newLot, type LotEntry } from "../../components/lot-rows";
import { colors, spacing } from "../../theme";
import { isTrackedItem, type InventoryItem, type ReceiptLineInput } from "../../api/types";

type Props = NativeStackScreenProps<RootStackParamList, "ReceivingAdHoc">;

const todayIso = () => new Date().toISOString().slice(0, 10);

/** One item being received, with however many lots it arrived in. */
type DraftLine = { key: string; item: InventoryItem; unitCost: string; lots: LotEntry[] };

let lineKeySeq = 0;

export default function ReceivingAdHocScreen({ navigation }: Props) {
  const [items, setItems] = useState<InventoryItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const [lines, setLines] = useState<DraftLine[]>([]);
  const [supplierLabel, setSupplierLabel] = useState("");
  const [receiptDate, setReceiptDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setItems(await listItems());
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : "Could not load the item register.");
    }
  }, []);

  useFocusEffect(useCallback(() => { if (items === null) load(); }, [items, load]));

  // Only stock-holding items can be received; a Service/Non-Inventory item has
  // no lot to create, and the backend rejects it anyway.
  const receivable = useMemo(() => (items ?? []).filter(isTrackedItem), [items]);

  const addItem = (item: InventoryItem) => {
    setPickerOpen(false);
    setLines((s) => [...s, {
      key: `line-${++lineKeySeq}`,
      item,
      unitCost: item.unitCost != null ? String(item.unitCost) : "",
      lots: [newLot()],
    }]);
  };

  const onSubmit = async () => {
    setError(null);
    const payload: ReceiptLineInput[] = lines.flatMap((line) => {
      const cost = parseFloat(line.unitCost) || 0;
      return line.lots.flatMap((lot) => {
        const qty = parseFloat(lot.qty);
        if (!qty || qty <= 0) return [];
        return [{
          itemId: line.item.id,
          qtyBase: qty,
          unitCost: cost,
          lotNo: lot.lotNo.trim() || null,
          expiryDate: lot.expiry.trim() || null,
        }];
      });
    });

    if (payload.length === 0) {
      setError("Add an item and enter a quantity for at least one lot.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await postGoodsReceipt({
        supplierLabel: supplierLabel.trim() || null,
        receiptDate,
        notes: notes.trim() || null,
        lines: payload,
      });
      setDone(result.receiptNo);
      setTimeout(() => navigation.navigate("ReceivingList"), 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not post the goods receipt.");
    } finally {
      setSubmitting(false);
    }
  };

  if (items === null && !loadError) return <Loading />;

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Screen>
          <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg }}>
            Receive stock that arrived without a purchase order. It posts to inventory the same way —
            a Bill can be raised against it later.
          </Text>

          <ErrorBanner message={loadError ?? error} />
          <SuccessBanner message={done ? `Goods receipt ${done} posted.` : null} />

          {lines.map((line) => (
            <Card key={line.key}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
                <View style={{ flex: 1, paddingRight: spacing.sm }}>
                  <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{line.item.name}</Text>
                  <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: spacing.md }}>
                    {line.item.code ? `${line.item.code} · ` : ""}On hand {line.item.onHandQty} {line.item.baseUom ?? ""}
                  </Text>
                </View>
                <Pressable onPress={() => setLines((s) => s.filter((l) => l.key !== line.key))} hitSlop={8}>
                  <Text style={{ fontSize: 13, color: colors.danger }}>Remove</Text>
                </Pressable>
              </View>
              <Field
                label={`Unit cost per ${line.item.baseUom ?? "unit"}`}
                value={line.unitCost}
                onChangeText={(v) => setLines((s) => s.map((l) => (l.key === line.key ? { ...l, unitCost: v } : l)))}
                keyboardType="decimal-pad"
                placeholder="0.00"
              />
              <LotRows
                lots={line.lots}
                onChange={(lots) => setLines((s) => s.map((l) => (l.key === line.key ? { ...l, lots } : l)))}
                baseUom={line.item.baseUom}
              />
            </Card>
          ))}

          {lines.length === 0 && <EmptyState message="No items added yet." />}

          <Button
            title="+ Add item"
            variant="secondary"
            onPress={() => setPickerOpen(true)}
            disabled={receivable.length === 0}
          />
          {receivable.length === 0 && !loadError && (
            <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: spacing.sm }}>
              No stock-tracked items exist yet — an admin needs to create them in the item register first.
            </Text>
          )}

          <View style={{ height: spacing.md }} />
          <Card>
            <Field
              label="Supplier (optional)"
              value={supplierLabel}
              onChangeText={setSupplierLabel}
              placeholder="Who delivered it"
            />
            <Field label="Receipt date" value={receiptDate} onChangeText={setReceiptDate} placeholder="YYYY-MM-DD" />
            <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
          </Card>

          <Button
            title="Post goods receipt"
            onPress={onSubmit}
            loading={submitting}
            disabled={!!done || lines.length === 0}
          />
        </Screen>
      </ScrollView>

      <PickerModal
        visible={pickerOpen}
        title="Choose an item"
        items={receivable}
        keyOf={(i) => i.id}
        labelOf={(i) => i.name}
        sublabelOf={(i) => [i.code, i.baseUom ? `in ${i.baseUom}` : null].filter(Boolean).join(" · ") || null}
        onSelect={addItem}
        onClose={() => setPickerOpen(false)}
      />
    </>
  );
}
