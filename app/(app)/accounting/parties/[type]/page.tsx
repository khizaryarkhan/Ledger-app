import { PartyList } from "@/components/party-list";

const VALID = ["customers", "suppliers", "employees"] as const;

export default function PartiesPage({ params }: { params: { type: string } }) {
  const type = (VALID as readonly string[]).includes(params.type) ? params.type : "customers";
  return <PartyList type={type as "customers" | "suppliers" | "employees"} />;
}
