import { NewDocumentForm } from "@/components/new-document-form";
import { redirect } from "next/navigation";

const TYPES = ["Invoice","SalesReceipt","CreditNote","RefundReceipt","Bill","Expense","VendorCredit","Payment","BillPayment","Deposit","Transfer"] as const;

export default function NewDocumentPage({ params }: { params: { type: string } }) {
  if (!(TYPES as readonly string[]).includes(params.type)) redirect("/accounting/new/Invoice");
  return <NewDocumentForm type={params.type as (typeof TYPES)[number]} />;
}
