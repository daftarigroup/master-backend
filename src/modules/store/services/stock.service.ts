import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ItemCandidate, normalizeItemName, pickItem } from './itemRef.service';

/**
 * Store stock, computed on the server per PROJECT + GROUP HEAD + NAME (one "Store item", see itemRef.service.ts).
 *
 *   current = opening + lifted + transferred-in goods receipts + (stock_transfers in - out)
 *             - purchase returns - (issued - issue returns)
 *
 *   opening          the oldest inventory row of that Store item (what the Store screen reads)
 *   lifted           store_in.received_quantity with a real material_date and not a 'Transfer' row
 *   transferred in   store_in rows with receiving_status 'Transfer' (no date needed)
 *   stock_transfers  quantity into (to_firm_id) / out of (from_firm_id) the project
 *   purchase return  store_in.received_quantity where status = 'Reject'
 *   issued           issue.given_qty;  issue return: issue.rejected_damage_qty
 *
 * This is the formula of the Store screen (FE lib/inventoryUtils.ts calculateRealInventory) made per project, per group head and
 * safe against text noise in the text quantity columns (anything that is not a number counts as 0 instead of failing).
 * The old server formula ignored opening, the material date, transfers and issue returns, and wrote one all-project total into
 * every project's inventory row.
 */
type Db = Prisma.TransactionClient;

export interface StockRow {
  firmId: bigint | null;
  itemId: bigint | null; // the oldest master item of this Store item, null when the master has none
  itemName: string;
  groupHead: string;
  opening: number;
  indented: number;
  approved: number;
  purchaseQuantity: number;
  received: number; // all received_quantity (including rejected)
  lifted: number;
  transferIn: number; // store_in 'Transfer' rows
  transfersIn: number; // stock_transfers table
  transfersOut: number;
  purchaseReturn: number;
  requested: number;
  issued: number;
  issueReturn: number;
  current: number;
  inventoryRowIds: bigint[];
}

const NORM = (c: string) => `lower(btrim(regexp_replace(${c}, '[[:space:]]+', ' ', 'g')))`;
// text quantity -> number; anything that is not a plain number is 0 (never an error)
const NUM = (c: string) => `(CASE WHEN btrim(COALESCE(${c}, '')) ~ '^-?[0-9]+([.][0-9]+)?$' THEN btrim(${c})::numeric ELSE 0 END)`;
const FIRM = (alias: string, idCol: string, nameCols: string[]) =>
  `COALESCE(${alias}.${idCol}, ${nameCols.length ? `(SELECT f.id FROM firm f WHERE ${nameCols.map((n) => `${NORM('f.firm_name')} = ${NORM(`${alias}.${n}`)}`).join(' OR ')} ORDER BY f.id LIMIT 1)` : 'NULL'})`;
const VALID_DATE = `(x.material_date IS NOT NULL AND btrim(x.material_date::text) <> '' AND lower(btrim(x.material_date::text)) NOT IN ('null', 'undefined', '-', 'n/a'))`;

const big = (v: unknown): bigint | null => (v === null || v === undefined ? null : BigInt(v as any));
const num = (v: unknown): number => Number(v ?? 0) || 0;
const noneKey = (f: bigint | null) => (f === null ? 'none' : String(f));

interface ItemRow { id: bigint; firm_id: bigint | null; name: string; gh: string | null }

export class StockService {
  /**
   * Stock per Store item. `firmId` limits to one project; `name` to one item name (any group head). Both optional.
   */
  static async compute(db: Db | typeof prisma, opts: { firmId?: bigint | number | string | null; name?: string | null } = {}): Promise<StockRow[]> {
    const firmId = opts.firmId === undefined || opts.firmId === null || opts.firmId === '' ? null : BigInt(opts.firmId as any);
    const nameNorm = opts.name ? normalizeItemName(opts.name) : null;
    const q = <T>(sql: string, ...p: unknown[]) => (db as any).$queryRawUnsafe(sql, ...p) as Promise<T[]>;
    const P = [firmId, nameNorm];

    const [inv, ind, sin, iss, trf, items] = await Promise.all([
      q<any>(`SELECT x.id, ${FIRM('x', 'firm_id', ['firm_name'])} AS firm, x.item_name AS name, x.group_head AS gh, x.item_id, ${NUM('x.opening')} AS opening
              FROM inventory x WHERE ($2::text IS NULL OR ${NORM('x.item_name')} = $2) AND ($1::bigint IS NULL OR ${FIRM('x', 'firm_id', ['firm_name'])} = $1)`, ...P),
      // indents are read by name only: a goods receipt in one project may belong to an indent we still need for its group head
      q<any>(`SELECT x.id, ${FIRM('x', 'firm_id', ['firm_name'])} AS firm, x.product_name AS name, x.group_head AS gh, x.item_id, x.indent_number, ${NUM('x.quantity')} AS q, ${NUM('x.approved_quantity')} AS a
              FROM indent x WHERE ($1::text IS NULL OR ${NORM('x.product_name')} = $1)`, nameNorm),
      q<any>(`SELECT x.id, ${FIRM('x', 'firm_id', ['firm_name', 'firm_name_match'])} AS firm, x.product_name AS name, x.indent_no, x.item_id, ${NUM('x.qty')} AS qty, ${NUM('x.received_quantity')} AS rec,
                     (x.status = 'Reject') AS rejected, (x.receiving_status = 'Transfer') AS is_transfer, ${VALID_DATE} AS has_date
              FROM store_in x WHERE ($2::text IS NULL OR ${NORM('x.product_name')} = $2) AND ($1::bigint IS NULL OR ${FIRM('x', 'firm_id', ['firm_name', 'firm_name_match'])} = $1)`, ...P),
      q<any>(`SELECT x.id, ${FIRM('x', 'firm_id', ['firm_name'])} AS firm, x.product_name AS name, x.group_head AS gh, x.item_id, ${NUM('x.quantity')} AS req, ${NUM('x.given_qty')} AS given, ${NUM('x.rejected_damage_qty')} AS ret
              FROM issue x WHERE ($2::text IS NULL OR ${NORM('x.product_name')} = $2) AND ($1::bigint IS NULL OR ${FIRM('x', 'firm_id', ['firm_name'])} = $1)`, ...P),
      q<any>(`SELECT x.id, x.from_firm_id, x.to_firm_id, x.product_name AS name, x.group_head AS gh, x.item_id, COALESCE(x.quantity, 0) AS qty
              FROM stock_transfers x WHERE ($2::text IS NULL OR ${NORM('x.product_name')} = $2)
                AND ($1::bigint IS NULL OR x.from_firm_id = $1 OR x.to_firm_id = $1)`, ...P),
      q<ItemRow>(`SELECT i.id, i.firm_id, i.item_name AS name, g.name AS gh FROM item i LEFT JOIN group_head g ON g.id = i.group_head_id
                  WHERE ($1::text IS NULL OR ${NORM('i.item_name')} = $1)`, nameNorm),
    ]);

    // ---- who is who in the item master ----
    const itemById = new Map<string, ItemRow>();
    const byFirmName = new Map<string, ItemCandidate[]>();
    for (const i of items) {
      itemById.set(String(i.id), i);
      const k = `${noneKey(big(i.firm_id))}|${normalizeItemName(i.name)}`;
      if (!byFirmName.has(k)) byFirmName.set(k, []);
      byFirmName.get(k)!.push({ id: BigInt(i.id), groupHead: i.gh });
    }
    const oldestCopy = (item: ItemRow): bigint => {
      const same = (byFirmName.get(`${noneKey(big(item.firm_id))}|${normalizeItemName(item.name)}`) ?? []).filter((c) => normalizeItemName(c.groupHead) === normalizeItemName(item.gh));
      return same.reduce((m, c) => (c.id < m ? c.id : m), BigInt(item.id));
    };

    const indentGh = new Map<string, { gh: string | null; itemId: bigint | null }>();
    for (const r of ind) {
      const k = `${String(r.indent_number ?? '').trim()}|${normalizeItemName(r.name)}`;
      if (!indentGh.has(k) || (!indentGh.get(k)!.itemId && r.item_id)) indentGh.set(k, { gh: r.gh, itemId: big(r.item_id) });
    }

    // group heads the project's inventory actually holds for a name: when a row cannot say its group head and the master is ambiguous,
    // a single inventory group head settles it (the stock lives there)
    const invHeads = new Map<string, Set<string>>();
    for (const r of inv) {
      const k = `${noneKey(big(r.firm))}|${normalizeItemName(r.name)}`;
      if (!invHeads.has(k)) invHeads.set(k, new Set());
      invHeads.get(k)!.add(String(r.gh ?? '').trim());
    }

    const buckets = new Map<string, StockRow>();
    const bucketFor = (firm: bigint | null, name: string, gh: string | null, itemId: bigint | null, indentRef?: string | null): StockRow => {
      let id: bigint | null = null;
      let itemName = String(name ?? '').trim();
      let groupHead = String(gh ?? '').trim();
      const linked = itemId !== null ? itemById.get(String(itemId)) : undefined;
      if (linked) {
        id = oldestCopy(linked);
        itemName = linked.name;
        groupHead = linked.gh ?? groupHead;
      } else {
        let ghForPick: string | null = gh;
        if (!ghForPick && indentRef) {
          const ref = indentGh.get(`${String(indentRef).trim()}|${normalizeItemName(name)}`);
          if (ref?.itemId && itemById.get(String(ref.itemId))) return bucketFor(firm, name, gh, ref.itemId);
          ghForPick = ref?.gh ?? null;
        }
        const cands = byFirmName.get(`${noneKey(firm)}|${normalizeItemName(name)}`) ?? [];
        let picked = pickItem(cands, ghForPick);
        if (picked === null && !ghForPick) {
          const heads = invHeads.get(`${noneKey(firm)}|${normalizeItemName(name)}`);
          if (heads && heads.size === 1) {
            ghForPick = [...heads][0] || null;
            picked = pickItem(cands, ghForPick);
          }
        }
        if (picked !== null) {
          const it = itemById.get(String(picked))!;
          id = picked;
          itemName = it.name;
          groupHead = it.gh ?? groupHead;
        } else {
          groupHead = String(ghForPick ?? '').trim();
        }
      }
      const key = `${noneKey(firm)}|${id !== null ? `id:${id}` : `n:${normalizeItemName(itemName)}|${normalizeItemName(groupHead)}`}`;
      let b = buckets.get(key);
      if (!b) {
        b = { firmId: firm, itemId: id, itemName, groupHead, opening: 0, indented: 0, approved: 0, purchaseQuantity: 0, received: 0, lifted: 0, transferIn: 0, transfersIn: 0, transfersOut: 0, purchaseReturn: 0, requested: 0, issued: 0, issueReturn: 0, current: 0, inventoryRowIds: [] };
        buckets.set(key, b);
      }
      return b;
    };

    // inventory rows: opening comes from the oldest row of the Store item; every row of it gets the computed totals
    const invSorted = [...inv].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1));
    const seenOpening = new Set<StockRow>();
    for (const r of invSorted) {
      const b = bucketFor(big(r.firm), r.name, r.gh, big(r.item_id));
      b.inventoryRowIds.push(BigInt(r.id));
      if (!seenOpening.has(b)) { b.opening = num(r.opening); seenOpening.add(b); }
    }
    for (const r of ind) {
      const f = big(r.firm);
      if (firmId !== null && f !== firmId) continue;
      const b = bucketFor(f, r.name, r.gh, big(r.item_id));
      b.indented += num(r.q);
      b.approved += num(r.a);
    }
    for (const r of sin) {
      const b = bucketFor(big(r.firm), r.name, null, big(r.item_id), r.indent_no);
      b.purchaseQuantity += num(r.qty);
      b.received += num(r.rec);
      if (r.rejected) b.purchaseReturn += num(r.rec);
      if (r.is_transfer) b.transferIn += num(r.rec);
      else if (r.has_date && num(r.rec) > 0) b.lifted += num(r.rec);
    }
    for (const r of iss) {
      const b = bucketFor(big(r.firm), r.name, r.gh, big(r.item_id));
      b.requested += num(r.req);
      b.issued += num(r.given);
      b.issueReturn += num(r.ret);
    }
    for (const r of trf) {
      const qty = num(r.qty);
      if (qty <= 0) continue;
      const to = big(r.to_firm_id);
      const from = big(r.from_firm_id);
      if (to !== null && (firmId === null || to === firmId)) bucketFor(to, r.name, r.gh, big(r.item_id)).transfersIn += qty;
      if (from !== null && (firmId === null || from === firmId)) bucketFor(from, r.name, r.gh, big(r.item_id)).transfersOut += qty;
    }

    const out = [...buckets.values()].filter((b) => firmId === null || b.firmId === firmId);
    for (const b of out) {
      b.current = b.opening + b.lifted + b.transferIn + (b.transfersIn - b.transfersOut) - b.purchaseReturn - (b.issued - b.issueReturn);
    }
    return out.sort((a, b) => a.itemName.localeCompare(b.itemName) || a.groupHead.localeCompare(b.groupHead));
  }

  /**
   * Store average purchase price of an item in a project (the screen's rule, on the server): the weighted average, over the goods
   * receipts that have really arrived (material date, not transfers), of the rate found in this order: PO line rate, approved indent
   * rate, the receipt's own price / rate, the indent's first quoted rate. Falls back to the inventory row's average / individual
   * rate. Null when nothing is known (the caller then lets the firm default rate apply).
   */
  static async averageRate(db: Db | typeof prisma, opts: { firmId: bigint | number | string; name: string; groupHead?: string | null }): Promise<number | null> {
    const q = <T>(sql: string, ...p: unknown[]) => (db as any).$queryRawUnsafe(sql, ...p) as Promise<T[]>;
    const name = normalizeItemName(opts.name);
    const gh = normalizeItemName(opts.groupHead);
    const rows = await q<{ q: string; r: string }>(
      `SELECT ${NUM('s.received_quantity')} AS q,
              COALESCE(NULLIF(po.r, 0), NULLIF(ind.approved, 0), NULLIF(${NUM('s.price_as_per_po_check')}, 0), NULLIF(${NUM('s.rate')}, 0), NULLIF(ind.rate1, 0), 0) AS r
       FROM store_in s
       LEFT JOIN LATERAL (SELECT ${NUM('i.approved_rate')} AS approved, ${NUM('i.rate1')} AS rate1, i.po_number, i.group_head
                          FROM indent i WHERE i.indent_number = s.indent_no AND ${NORM('i.product_name')} = ${NORM('s.product_name')} LIMIT 1) ind ON TRUE
       LEFT JOIN LATERAL (SELECT ${NUM('p.rate')} AS r FROM po_master p
                          WHERE p.po_number = COALESCE(NULLIF(s.po_number, ''), ind.po_number) AND ${NORM('p.product')} = ${NORM('s.product_name')}
                          ORDER BY p.id LIMIT 1) po ON TRUE
       WHERE ${FIRM('s', 'firm_id', ['firm_name', 'firm_name_match'])} = $1::bigint AND ${NORM('s.product_name')} = $2
         AND ($3 = '' OR ind.group_head IS NULL OR ${NORM('ind.group_head')} = $3)
         AND COALESCE(s.receiving_status, '') <> 'Transfer'
         AND ${VALID_DATE.replace(/x\./g, 's.')}
         AND ${NUM('s.received_quantity')} > 0`,
      BigInt(opts.firmId as any), name, gh,
    );
    let value = 0;
    let qty = 0;
    for (const r of rows) {
      const rate = Number(r.r);
      const quantity = Number(r.q);
      if (rate > 0 && quantity > 0) { value += rate * quantity; qty += quantity; }
    }
    if (qty > 0 && value > 0) return Math.round((value / qty) * 100) / 100;
    const inv = await q<{ r: string }>(
      `SELECT COALESCE(NULLIF(COALESCE(x.avg_price, 0), 0), NULLIF(${NUM('x.individual_rate')}, 0), 0) AS r FROM inventory x
       WHERE ${FIRM('x', 'firm_id', ['firm_name'])} = $1::bigint AND ${NORM('x.item_name')} = $2 ORDER BY x.id LIMIT 1`,
      BigInt(opts.firmId as any), name,
    );
    const fallback = Number(inv[0]?.r ?? 0);
    return fallback > 0 ? fallback : null;
  }

  /** Write the computed totals into the inventory rows of the item name (all projects, each with its own numbers). */
  static async syncInventory(db: Db | typeof prisma, name: string): Promise<void> {
    if (!normalizeItemName(name)) return;
    const rows = await this.compute(db, { name });
    for (const b of rows) {
      if (b.inventoryRowIds.length === 0) continue;
      await (db as any).$executeRawUnsafe(
        `UPDATE inventory SET indented = $2::numeric, approved = $3::numeric, purchase_quantity = $4::numeric, received_quantity = $5::numeric,
                return_quantity = $6::numeric, request_quantity = $7::numeric, out_quantity = $8::numeric, "current" = $9::numeric,
                color_code = $10
         WHERE id = ANY($1::bigint[])`,
        b.inventoryRowIds.map(String), b.indented, b.approved, b.purchaseQuantity, b.received, b.purchaseReturn, b.requested, b.issued, b.current,
        b.current < 5 ? 'red' : 'green', // as the old client-side patch did: red when empty or below 5
      );
    }
  }
}
