import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import {
  chaseScheduler, runOrgChase, brokenPromiseSweep,
  qboSyncScheduler, runOrgQboSync,
  xeroSyncScheduler, runOrgXeroSync,
  runBatchCommit, runBatchUndo, scheduledImportScan, runScheduledImportFn, runEstimateInvoiceBatchFn,
} from "@/inngest";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    chaseScheduler,
    runOrgChase,
    brokenPromiseSweep,
    qboSyncScheduler,
    runOrgQboSync,
    xeroSyncScheduler,
    runOrgXeroSync,
    runBatchCommit,
    runBatchUndo,
    scheduledImportScan,
    runScheduledImportFn,
    runEstimateInvoiceBatchFn,
  ],
});
