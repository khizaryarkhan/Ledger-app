import { PartyList } from "@/components/party-list";

const VALID = ["customers", "suppliers", "employees"] as const;

export default function PartiesPage({ params }: { params: { type: string } }) {
  const type = (VALID as readonly string[]).includes(params.type) ? params.type : "customers";
  // The Accounting module is a self-contained native ledger — native records
  // only. QBO/Xero names belong to the Receivable & Payable modules.
  return <PartyList type={type as "customers" | "suppliers" | "employees"} nativeOnly />;
}
