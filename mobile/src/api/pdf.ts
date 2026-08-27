import { Platform } from "react-native";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { API_BASE_URL } from "../config";
import { getStoredTokens } from "./client";

/**
 * Can this platform hand a downloaded file to the user?
 *
 * The web preview target has no filesystem or share sheet — expo-file-system
 * and expo-sharing ship inert web stubs. So the button is hidden there rather
 * than offered and then failing silently.
 */
export const canSharePdf = Platform.OS !== "web";

/**
 * Downloads an invoice PDF and hands it to the OS share sheet (open in a PDF
 * viewer, mail it, save to Files).
 *
 * It can't just open the URL in a browser: the endpoint authenticates with the
 * bearer token held in SecureStore, which the system browser doesn't have. So
 * the file is fetched with the header attached, written into the cache
 * directory, and shared from there.
 */
export async function shareInvoicePdf(invoiceId: string, invoiceNumber: string): Promise<void> {
  if (!canSharePdf) throw new Error("Downloading a PDF isn't supported in the web preview.");

  const { accessToken } = await getStoredTokens();
  if (!accessToken) throw new Error("Please sign in again.");

  // Filenames reach the share sheet, so keep them readable but path-safe.
  const safe = invoiceNumber.replace(/[^A-Za-z0-9._-]+/g, "-") || invoiceId;
  const dir = new Directory(Paths.cache, "invoices");
  if (!dir.exists) dir.create({ intermediates: true });
  const target = new File(dir, `Invoice-${safe}.pdf`);

  await File.downloadFileAsync(
    `${API_BASE_URL}/api/invoices/${invoiceId}/pdf`,
    target,
    { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/pdf" }, idempotent: true },
  );

  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing isn't available on this device.");
  await Sharing.shareAsync(target.uri, { mimeType: "application/pdf", UTI: "com.adobe.pdf" });
}
