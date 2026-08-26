import type { NavigatorScreenParams, CompositeScreenProps } from "@react-navigation/native";
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import type { OpenPo, OpenSo, BomSummary } from "../api/types";

/**
 * The four bottom tabs — the app's permanent furniture. Everything else is a
 * screen PUSHED onto the parent stack, so a tab is always one tap away no
 * matter how deep you've navigated.
 */
export type TabParamList = {
  HomeTab: undefined;
  TodayTab: undefined;
  AlertsTab: undefined;
  ProfileTab: undefined;
};

export type RootStackParamList = {
  Tabs: NavigatorScreenParams<TabParamList>;

  // Receivables (collections)
  ReceivablesOverview: undefined;
  /** `customerId` narrows the list to one customer; `customerName` renames the header. */
  ReceivablesInvoices: { customerId?: string; customerName?: string; filter?: string } | undefined;
  ReceivablesInvoiceDetail: { invoiceId: string; invoiceNumber?: string };
  ReceivablesEscalations: undefined;
  ReceivablesCustomers: undefined;

  // Operations (warehouse & production)
  ReceivingList: undefined;
  ReceivingDetail: { po: OpenPo };
  ReceivingAdHoc: undefined;
  ProductionList: undefined;
  ProductionDetail: { bom: BomSummary };
  ShippingList: undefined;
  ShippingDetail: { so: OpenSo };
};

/**
 * Props for a screen inside the tab bar. Composite because navigation actions
 * bubble: a tab screen can push any stack route (`navigate("ReceivingList")`)
 * as well as switch tabs, and the types should say so.
 */
export type TabScreenProps<T extends keyof TabParamList> = CompositeScreenProps<
  BottomTabScreenProps<TabParamList, T>,
  NativeStackScreenProps<RootStackParamList>
>;
