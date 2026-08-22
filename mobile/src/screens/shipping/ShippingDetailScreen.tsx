import React, { useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { RootStackParamList } from "../../navigation/types";
import { postShipment } from "../../api/inventory";
import { ApiError } from "../../api/client";
import { Button, Card, ErrorBanner, Field, Screen } from "../../components/ui";
import { colors, spacing } from "../../theme";

type Props = NativeStackScreenProps<RootStackParamList, "ShippingDetail">;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export default function ShippingDetailScreen({ route, navigation }: Props) {
  const { so } = route.params;
  const openLines = useMemo(() => so.lines.filter((l) => l.remainingQty > 0.0001), [so]);

  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(openLines.map((l) => [l.lineId, String(l.remainingQty)])),
  );
  const [shipmentDate, setShipmentDate] = useState(todayIso());
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
          soId: so.id,
          soLineId: l.lineId,
          qtyBase: q,
          saleRate: l.saleRateBase,
          taxRateId: l.taxRateId,
        };
      })
      .filter(Boolean) as any[];

    if (lines.length === 0) {
      setError("Enter a quantity for at least one line.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await postShipment({
        customerId: so.partyId,
        customerLabel: so.partyLabel,
        shipmentDate,
        currency: so.currency,
        exchangeRate: so.exchangeRate,
        notes: notes || null,
        lines,
      });
      setDone(result.shipmentNo);
      setTimeout(() => navigation.navigate("ShippingList"), 1200);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Could not post the shipment.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: 20, fontWeight: "700", color: colors.text }}>{so.docNumber}</Text>
        <Text style={{ fontSize: 14, color: colors.textMuted, marginBottom: spacing.lg }}>
          {so.partyLabel ?? "Unknown customer"}
        </Text>

        <ErrorBanner message={error} />
        {done && (
          <View style={{ backgroundColor: "#F0FDF4", borderColor: "#BBF7D0", borderWidth: 1, borderRadius: 8, padding: spacing.md, marginBottom: spacing.md }}>
            <Text style={{ color: colors.success }}>Shipment {done} posted.</Text>
          </View>
        )}

        {openLines.map((line) => (
          <Card key={line.lineId}>
            <Text style={{ fontSize: 15, fontWeight: "600", color: colors.text }}>{line.itemName}</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm }}>
              Ordered {line.orderedBaseQty} {line.baseUom} · Shipped {line.shippedQty} · Remaining {line.remainingQty}
            </Text>
            <Field
              label={`Quantity to ship (${line.baseUom})`}
              value={qty[line.lineId]}
              onChangeText={(v) => setQty((s) => ({ ...s, [line.lineId]: v }))}
              keyboardType="decimal-pad"
            />
          </Card>
        ))}

        <Card>
          <Field label="Shipment date" value={shipmentDate} onChangeText={setShipmentDate} placeholder="YYYY-MM-DD" />
          <Field label="Notes (optional)" value={notes} onChangeText={setNotes} multiline />
        </Card>

        <Button title="Post shipment" onPress={onSubmit} loading={submitting} disabled={!!done} />
      </Screen>
    </ScrollView>
  );
}
