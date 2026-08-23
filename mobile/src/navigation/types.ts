import type { OpenPo, OpenSo, BomSummary } from "../api/types";

export type RootStackParamList = {
  Home: undefined;
  ReceivingList: undefined;
  ReceivingDetail: { po: OpenPo };
  ReceivingAdHoc: undefined;
  ProductionList: undefined;
  ProductionDetail: { bom: BomSummary };
  ShippingList: undefined;
  ShippingDetail: { so: OpenSo };
};
