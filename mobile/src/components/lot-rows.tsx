import React from "react";
import { Pressable, Text, View } from "react-native";
import { Field } from "./ui";
import { colors, spacing } from "../theme";

/**
 * One physical lot/batch being received. A single ordered line is often
 * delivered as several lots (different batch numbers, different expiry dates),
 * and each has to become its own FIFO cost layer — so the receipt sends one
 * line per lot rather than one line per item.
 */
export type LotEntry = { key: string; qty: string; lotNo: string; expiry: string };

let lotKeySeq = 0;
export const newLot = (qty = ""): LotEntry => ({ key: `lot-${++lotKeySeq}`, qty, lotNo: "", expiry: "" });

export const lotQtyTotal = (lots: LotEntry[]) =>
  lots.reduce((sum, l) => sum + (parseFloat(l.qty) || 0), 0);

export function LotRows({
  lots, onChange, baseUom, remaining,
}: {
  lots: LotEntry[];
  onChange: (lots: LotEntry[]) => void;
  baseUom: string | null;
  /** Outstanding qty on the order line, when receiving against one. */
  remaining?: number;
}) {
  const uom = baseUom ?? "units";
  const total = lotQtyTotal(lots);
  const over = remaining != null && total > remaining + 0.0001;

  const update = (key: string, patch: Partial<LotEntry>) =>
    onChange(lots.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  return (
    <View>
      {lots.map((lot, idx) => (
        <View
          key={lot.key}
          style={{
            marginTop: idx === 0 ? 0 : spacing.md,
            paddingTop: idx === 0 ? 0 : spacing.md,
            borderTopWidth: idx === 0 ? 0 : 1,
            borderTopColor: colors.border,
          }}
        >
          {lots.length > 1 && (
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.xs }}>
              <Text style={{ fontSize: 13, fontWeight: "600", color: colors.textMuted }}>Lot {idx + 1}</Text>
              <Pressable onPress={() => onChange(lots.filter((l) => l.key !== lot.key))} hitSlop={8}>
                <Text style={{ fontSize: 13, color: colors.danger }}>Remove</Text>
              </Pressable>
            </View>
          )}
          <Field
            label={`Quantity (${uom})`}
            value={lot.qty}
            onChangeText={(v) => update(lot.key, { qty: v })}
            keyboardType="decimal-pad"
          />
          <Field
            label="Lot / batch number (optional)"
            value={lot.lotNo}
            onChangeText={(v) => update(lot.key, { lotNo: v })}
          />
          <Field
            label="Expiry date, YYYY-MM-DD (optional)"
            value={lot.expiry}
            onChangeText={(v) => update(lot.key, { expiry: v })}
            placeholder="2027-01-31"
          />
        </View>
      ))}

      <Pressable onPress={() => onChange([...lots, newLot()])} hitSlop={8}>
        <Text style={{ fontSize: 14, fontWeight: "600", color: colors.accent, marginTop: spacing.sm }}>
          + Add another lot
        </Text>
      </Pressable>

      {lots.length > 1 && (
        <Text style={{ fontSize: 13, color: over ? colors.danger : colors.textMuted, marginTop: spacing.sm }}>
          Total across {lots.length} lots: {Math.round(total * 1e4) / 1e4} {uom}
          {remaining != null ? ` of ${remaining} remaining` : ""}
        </Text>
      )}
      {over && (
        <Text style={{ fontSize: 13, color: colors.danger, marginTop: spacing.xs }}>
          That's more than the outstanding quantity — over-receipts are allowed, but check it's intended.
        </Text>
      )}
    </View>
  );
}
