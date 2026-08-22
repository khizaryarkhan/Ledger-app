import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { getBom, postProduction } from "../../api/inventory";
import { ApiError } from "../../api/client";
import { Button, Card, ErrorBanner, Field, Loading, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";
import type { BomDetail } from "../../api/types";

type Props = NativeStackScreenProps<RootStackParamList, "ProductionDetail">;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProductionDetailScreen({ route, navigation }: Props) {
  const { bom } = route.params;
  const [detail, setDetail] = useState<BomDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [qtyToProduce, setQtyToProduce] = useState(bom.batchSize);
  const [inputQty, setInputQty] = useState<Record<string, string>>({});
  const [lotNo, setLotNo] = useState("");
  const [expiry, setExpiry] = useState("");
  const [producedDate, setProducedDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    getBom(bom.id)
      .then((d) => {
        setDetail(d);
        seedInputQty(d, bom.batchSize);
      })
      .catch((e) => setLoadError(e instanceof ApiError ? e.message : "Could not load this BOM."));
  }, [bom.id]);

  const seedInputQty = (d: BomDetail, batchQty: string) => {
    const batchSize = parseFloat(d.bom.batchSize) || 1;
    const ratio = (parseFloat(batchQty) || 0) / batchSize;
    setInputQty(Object.fromEntries(d.inputs.map((l) => [l.id, String((parseFloat(l.qty) || 0) * ratio)])));
  };

  const recalculate = () => {
    if (detail) seedInputQty(detail, qtyToProduce);
  };

  const onSubmit = async () => {
    if (!detail || !bom.outputItemId) return;
    setError(null);
    const inputs = detail.inputs
      .map((l) => {
        const q = parseFloat(inputQty[l.id] ?? "0");
        if (!q || q <= 0) return null;
        return { itemId: l.itemId, qty: q };
      })
      .filter(Boolean) as any[];

    const produceQty = parseFloat(qtyToProduce);
    if (!produceQty || produceQty <= 0) {
      setError("Enter a quantity to produce.");
      return;
    }
    if (inputs.length === 0) {
      setError("Enter a quantity for at least one input.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await postProduction({
        bomId: bom.id,
        outputItemId: bom.outputItemId,
        qtyToProduce: produceQty,
        producedDate,
        lotNo: lotNo || null,
        expiryDate: expiry || null,
        notes: notes || null,
        inputs,
      });
      setDone(result.runNo);
      setTimeout(() => navigation.navigate("ProductionList"), 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not post the production run.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!detail && !loadError) return <Loading />;

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{bom.name}</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg }}>
          Produces {bom.outputItemName ?? "—"}
        </Text>

        <ErrorBanner message={loadError ?? error} />
        {done && (
          <View style={{ backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", borderWidth: 1, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md }}>
            <Text style={{ color: colors.success }}>Production run {done} posted.</Text>
          </View>
        )}

        {detail && (
          <>
            <Card>
              <Field label="Quantity to produce" value={qtyToProduce} onChangeText={setQtyToProduce} keyboardType="decimal-pad" />
              <Button title="Recalculate inputs from batch size" onPress={recalculate} variant="secondary" />
            </Card>

            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text, marginBottom: spacing.sm }}>Inputs consumed</Text>
            {detail.inputs.map((line) => (
              <Card key={line.id}>
                <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{line.item?.name ?? line.itemId}</Text>
                <Field
                  label={`Quantity (${line.item?.baseUom ?? line.uom ?? "units"})`}
                  value={inputQty[line.id] ?? ""}
                  onChangeText={(v) => setInputQty((s) => ({ ...s, [line.id]: v }))}
                  keyboardType="decimal-pad"
                />
              </Card>
            ))}

            <Card>
              <Field label="Produced lot / batch number (optional)" value={lotNo} onChangeText={setLotNo} />
              <Field label="Expiry date, YYYY-MM-DD (optional)" value={expiry} onChangeText={setExpiry} placeholder="2027-01-31" />
              <Field label="Produced date" value={producedDate} onChangeText={setProducedDate} placeholder="YYYY-MM-DD" />
              <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
            </Card>

            <Button title="Post production run" onPress={onSubmit} loading={submitting} disabled={!!done} />
          </>
        )}
      </Screen>
    </ScrollView>
  );
}
