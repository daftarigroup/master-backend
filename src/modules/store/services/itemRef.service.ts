import { Prisma } from '@prisma/client';

// store_item_ref_v1: the Store tables carry `item_id` (a link to the item master) next to the display name. The Store screens
// still send only the names, so the server fills `item_id` itself.
//
// How the Store defines an item: PROJECT + GROUP HEAD + NAME (the indent form picks the group head first and lists that group
// head's items; inventory has one row per project, group head and name). The item master may hold the same name several times
// in one project: under different group heads (different items, e.g. "10 MM TMT" under TMT and under STRUCTURAL STEEL) or as
// identical copies (same group head, e.g. DIESEL entered twice). So:
//   1. candidates = the project's items with that name (case / spacing ignored);
//   2. if the row knows its group head and some candidates have it, keep only those;
//   3. if the remaining candidates all share ONE group head they are the same Store item: link to the oldest (lowest id);
//   4. otherwise (several group heads, or no candidate) the row stays unlinked.
// The master is never changed. Stock must be counted per (project, group head, name), so which copy is linked never matters.
type Db = Prisma.TransactionClient;

export interface ItemCandidate {
  id: bigint;
  groupHead: string | null;
}

export const normalizeItemName = (s: unknown): string => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Pure rule shared by the server hooks and the backfill script. */
export function pickItem(candidates: ItemCandidate[], rowGroupHead?: unknown): bigint | null {
  if (candidates.length === 0) return null;
  let pool = candidates;
  const gh = normalizeItemName(rowGroupHead);
  if (gh) {
    const same = candidates.filter((c) => normalizeItemName(c.groupHead) === gh);
    if (same.length > 0) pool = same;
  }
  const heads = new Set(pool.map((c) => normalizeItemName(c.groupHead)));
  if (heads.size !== 1) return null;
  return pool.reduce((min, c) => (c.id < min ? c.id : min), pool[0].id);
}

interface RefTable {
  name: string; // the display-name column
  firmId: string; // the firm column
  firmNames: string[]; // firm-name columns used when the firm id is empty
  groupHead?: string; // the group-head column, when the table has one
  viaIndent?: string; // column holding the indent number, for tables without a group head (their indent knows it)
}

export const REF_TABLES: Record<string, RefTable> = {
  indent: { name: 'product_name', firmId: 'firm_id', firmNames: ['firm_name'], groupHead: 'group_head' },
  issue: { name: 'product_name', firmId: 'firm_id', firmNames: ['firm_name'], groupHead: 'group_head' },
  inventory: { name: 'item_name', firmId: 'firm_id', firmNames: ['firm_name'], groupHead: 'group_head' },
  stock_transfers: { name: 'product_name', firmId: 'from_firm_id', firmNames: [], groupHead: 'group_head' },
  store_in: { name: 'product_name', firmId: 'firm_id', firmNames: ['firm_name', 'firm_name_match'], viaIndent: 'indent_no' },
  po_master: { name: 'product', firmId: 'firm_id', firmNames: ['firm_name'], viaIndent: 'internal_code' },
  store_in_direct: { name: 'product_name', firmId: 'firm_id', firmNames: ['firm_name', 'firm_name_match'] },
};

const toBigInt = (v: unknown): bigint | null => {
  if (v === null || v === undefined || v === '') return null;
  try {
    return BigInt(v as any);
  } catch {
    return null;
  }
};

export class ItemRefService {
  static hasItemRef(table: string): boolean {
    return table in REF_TABLES;
  }

  /** The project's items with this name (case / spacing ignored), with their group head name. */
  static async candidates(db: Db, firmId: bigint, name: string): Promise<ItemCandidate[]> {
    const norm = normalizeItemName(name);
    if (!norm) return [];
    const rows = await db.$queryRaw<Array<{ id: bigint; gh: string | null }>>`
      SELECT i.id, g.name AS gh
      FROM item i LEFT JOIN group_head g ON g.id = i.group_head_id
      WHERE i.firm_id = ${firmId} AND lower(btrim(regexp_replace(i.item_name, '[[:space:]]+', ' ', 'g'))) = ${norm}`;
    return rows.map((r) => ({ id: r.id, groupHead: r.gh }));
  }

  private static async firmIdByName(db: Db, name: unknown): Promise<bigint | null> {
    const norm = normalizeItemName(name);
    if (!norm) return null;
    const rows = await db.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM firm WHERE lower(btrim(regexp_replace(firm_name, '[[:space:]]+', ' ', 'g'))) = ${norm} ORDER BY id LIMIT 1`;
    return rows[0]?.id ?? null;
  }

  private static async resolveFirm(db: Db, cfg: RefTable, row: Record<string, any>): Promise<bigint | null> {
    const direct = toBigInt(row[cfg.firmId]);
    if (direct !== null) return direct;
    for (const col of cfg.firmNames) {
      const id = await this.firmIdByName(db, row[col]);
      if (id !== null) return id;
    }
    return null;
  }

  /** Group head of the row: its own column, or (store_in / po_master) the group head of the indent it belongs to. */
  private static async resolveGroupHead(db: Db, cfg: RefTable, row: Record<string, any>): Promise<string | null> {
    if (cfg.groupHead) return row[cfg.groupHead] ? String(row[cfg.groupHead]) : null;
    if (!cfg.viaIndent || !row[cfg.viaIndent] || !row[cfg.name]) return null;
    const norm = normalizeItemName(row[cfg.name]);
    const rows = await db.$queryRaw<Array<{ gh: string | null }>>`
      SELECT group_head AS gh FROM indent
      WHERE indent_number = ${String(row[cfg.viaIndent]).trim()}
        AND lower(btrim(regexp_replace(product_name, '[[:space:]]+', ' ', 'g'))) = ${norm}
        AND group_head IS NOT NULL AND btrim(group_head) <> ''
      LIMIT 1`;
    return rows[0]?.gh ?? null;
  }

  /** Create: fill `data.item_id` unless the caller sent one. */
  static async fillOnCreate(db: Db, table: string, data: Record<string, any>): Promise<void> {
    const cfg = REF_TABLES[table];
    if (!cfg || toBigInt(data.item_id) !== null || !data[cfg.name]) return;
    const firm = await this.resolveFirm(db, cfg, data);
    if (firm === null) return;
    const id = pickItem(await this.candidates(db, firm, data[cfg.name]), await this.resolveGroupHead(db, cfg, data));
    if (id !== null) data.item_id = id;
  }

  /**
   * Update by id: when the request changes the display name (or the group head) and does not send an `item_id`, re-resolve it
   * (a stale link to the old item would be wrong). An unresolvable new name clears the link; unchanged names leave it alone.
   */
  static async fillOnUpdate(db: Db, table: string, existing: Record<string, any> | null, data: Record<string, any>): Promise<void> {
    const cfg = REF_TABLES[table];
    if (!cfg || !existing || data.item_id !== undefined) return;
    const nameChanged = data[cfg.name] !== undefined && normalizeItemName(data[cfg.name]) !== normalizeItemName(existing[cfg.name]);
    const ghChanged = !!cfg.groupHead && data[cfg.groupHead] !== undefined && normalizeItemName(data[cfg.groupHead]) !== normalizeItemName(existing[cfg.groupHead]);
    if (!nameChanged && !ghChanged) return;
    const merged = { ...existing, ...data };
    const firm = await this.resolveFirm(db, cfg, merged);
    data.item_id = firm === null ? null : pickItem(await this.candidates(db, firm, merged[cfg.name]), await this.resolveGroupHead(db, cfg, merged));
  }
}
