import { AccountingLists } from "../../settings/accounting/_lists";

// One Master Data list, deep-linked from the Accounting sidebar. The sidebar is
// the navigation, so the in-page tab bar is hidden here.
const VALID = ["accounts", "items", "tax-rates", "classes", "locations", "cost-centres", "custom-fields"] as const;

export default function AccountingListPage({ params }: { params: { list: string } }) {
  const list = (VALID as readonly string[]).includes(params.list) ? params.list : "accounts";
  return <AccountingLists initialTab={list as any} hideTabs />;
}
