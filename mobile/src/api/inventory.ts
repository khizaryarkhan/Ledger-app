import { api } from "./client";
import type {
  OpenPo, ReceiptInput, OpenSo, ShipmentInput, BomSummary, BomDetail, ProductionInput,
} from "./types";

export const listOpenPos = () => api.get<OpenPo[]>("/api/inventory/po-open");
export const postGoodsReceipt = (input: ReceiptInput) =>
  api.post<{ id: string; receiptNo: string; entryId: string; grirTotal: number }>("/api/inventory/receiving", input);

export const listOpenSos = () => api.get<OpenSo[]>("/api/inventory/so-open");
export const postShipment = (input: ShipmentInput) =>
  api.post<{ id: string; shipmentNo: string; entryId: string; cogsTotal: number; saleTotal: number }>(
    "/api/inventory/shipping", input,
  );

export const listBoms = () => api.get<BomSummary[]>("/api/inventory/boms");
export const getBom = (id: string) => api.get<BomDetail>(`/api/inventory/boms/${id}`);
export const postProduction = (input: ProductionInput) =>
  api.post<{ id: string; entryId: string; runNo: string; totalInputCost: number; unitCost: number; producedLotId: string | null }>(
    "/api/inventory/production", input,
  );
