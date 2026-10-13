// Fields the unauthenticated QR page may see. An explicit allow-list: anything added to the asset DTO later stays
// private until it is listed here. No cost, supplier, invoice, payment, people or firm fields.
const PUBLIC_ASSET_FIELDS = [
  "id", "sn", "productName", "brand", "model", "category", "type", "status", "department", "location",
  "serialNo", "sku", "mfgDate", "origin", "quantity", "warrantyAvailable", "warrantyEnd", "amc", "amcEnd",
  "lastMaintenanceDate", "nextService", "imageUrl",
] as const;

export function toPublicAsset(dto: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_ASSET_FIELDS) if (dto[key] !== undefined) out[key] = dto[key];
  return out;
}
