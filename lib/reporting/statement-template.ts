/**
 * Standard Management P&L template. Seeded when a company first sets up its
 * structure, then fully editable. Detail lines are the mappable targets (QBO
 * accounts map into them, via rules). Computed lines evaluate a formula over
 * other lines by `code`.
 */
export interface TemplateLine {
  code: string;
  name: string;
  lineKind: "detail" | "computed" | "header";
  sign: number;                              // +1 income-like, -1 cost-like (informational for detail)
  formula?: { code: string; op: "+" | "-" }[]; // computed lines only
}

export const MANAGEMENT_PL_TEMPLATE: TemplateLine[] = [
  { code: "revenue",          name: "Revenue",                    lineKind: "detail",   sign: 1 },
  { code: "cost_of_sales",    name: "Cost of Sales",              lineKind: "detail",   sign: -1 },
  { code: "gross_profit",     name: "Gross Profit",               lineKind: "computed", sign: 1, formula: [{ code: "revenue", op: "+" }, { code: "cost_of_sales", op: "-" }] },
  { code: "payroll",          name: "Payroll",                    lineKind: "detail",   sign: -1 },
  { code: "other_opex",       name: "Other Operating Expenses",   lineKind: "detail",   sign: -1 },
  { code: "ebitda",           name: "EBITDA",                     lineKind: "computed", sign: 1, formula: [{ code: "gross_profit", op: "+" }, { code: "payroll", op: "-" }, { code: "other_opex", op: "-" }] },
  { code: "depreciation",     name: "Depreciation & Amortisation", lineKind: "detail",  sign: -1 },
  { code: "operating_profit", name: "Operating Profit",           lineKind: "computed", sign: 1, formula: [{ code: "ebitda", op: "+" }, { code: "depreciation", op: "-" }] },
  { code: "other_income",     name: "Other Income",               lineKind: "detail",   sign: 1 },
  { code: "finance_costs",    name: "Finance Costs",              lineKind: "detail",   sign: -1 },
  { code: "net_profit",       name: "Net Profit",                 lineKind: "computed", sign: 1, formula: [{ code: "operating_profit", op: "+" }, { code: "other_income", op: "+" }, { code: "finance_costs", op: "-" }] },
];

export const STATEMENT_SLUG = "management-pl";
