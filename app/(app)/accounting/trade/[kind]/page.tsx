import { redirect } from "next/navigation";
import { TradeDocList } from "@/components/trade-doc-list";

const KINDS = ["estimates", "purchase-orders", "sales-orders"] as const;

export default function TradeDocsPage({ params }: { params: { kind: string } }) {
  if (!(KINDS as readonly string[]).includes(params.kind)) redirect("/accounting/trade/estimates");
  return <TradeDocList kind={params.kind as (typeof KINDS)[number]} />;
}
