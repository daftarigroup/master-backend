// Same small set of scalar-shaping helpers as modules/maintenance/services/mapUtils.ts
// — duplicated rather than cross-imported to keep this module independent, matching
// this backend's existing per-module convention (see petty-cash/document, which don't
// share code either).
export function decimalToNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(value);
}

export function decimalToNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return Number(value);
}

export function dateToISODate(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString().slice(0, 10);
}

export function dateToISO(value: Date | null | undefined): string | null {
  if (!value) return null;
  return value.toISOString();
}

export function userDTO(
  user: { id: bigint | number; name?: string | null; user_name?: string | null; employee?: { email?: string | null } | null } | null | undefined
) {
  if (!user) return null;
  return { id: String(user.id), name: user.name || user.user_name || 'User', email: user.employee?.email || '' };
}

export function parsePagination(query: Record<string, any>) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10) || 1);
  const limit = Math.max(1, Math.min(500, parseInt(String(query.limit ?? '20'), 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

export function paginationMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) || 1 };
}
