import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { LRUCache } from 'lru-cache';
import crypto from 'crypto';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { SequenceService } from '../services/sequence.service';
import { SchedulePlannerService } from '../services/schedulePlanner.service';
import { DelayCalculatorService } from '../services/delayCalculator.service';
import { InventoryStockService } from '../services/inventoryStock.service';
import { PcReportService } from '../services/pcReport.service';

// ============================================================
// Per-table TTL configuration based on update frequency:
// - Near-static reference/lookup tables: 5 minutes (300_000 ms)
// - Directory / config tables: 2 minutes (120_000 ms)
// - High-velocity transactional tables: 30 seconds (30_000 ms)
// ============================================================
export const TABLE_TTL_CONFIG: Record<string, { ttl: number; isPublic: boolean }> = {
  // Static Reference & Calendars (Changes rarely via admin)
  department: { ttl: 300_000, isPublic: true },
  uom: { ttl: 300_000, isPublic: false },
  area_of_use: { ttl: 300_000, isPublic: false },
  default_po_terms: { ttl: 300_000, isPublic: false },
  terms_and_condition: { ttl: 300_000, isPublic: false },
  company: { ttl: 300_000, isPublic: false },
  holiday: { ttl: 300_000, isPublic: true },
  working_day_calendar: { ttl: 300_000, isPublic: true },

  // Directory / Master Tables (Changes occasionally)
  firm: { ttl: 120_000, isPublic: false },
  item: { ttl: 120_000, isPublic: false },
  group_head: { ttl: 120_000, isPublic: false },
  vendors: { ttl: 120_000, isPublic: false },
  contractor_details: { ttl: 120_000, isPublic: false },
  site_location_details: { ttl: 120_000, isPublic: false },
  site_engineer_details: { ttl: 120_000, isPublic: false },

  // High-Velocity Transactional Tables (Changes frequently by operational users)
  indent: { ttl: 30_000, isPublic: false },
  store_in: { ttl: 30_000, isPublic: false },
  store_in_direct: { ttl: 30_000, isPublic: false },
  po_master: { ttl: 30_000, isPublic: false },
  issue: { ttl: 30_000, isPublic: false },
  tally_entry: { ttl: 30_000, isPublic: false },
  fullkitting: { ttl: 30_000, isPublic: false },
  payments: { ttl: 30_000, isPublic: false },
  payment_history: { ttl: 30_000, isPublic: false },
  inventory: { ttl: 30_000, isPublic: false },
  pc_report: { ttl: 30_000, isPublic: false },
  project_assignments: { ttl: 30_000, isPublic: false },
  project_assignment_events: { ttl: 60_000, isPublic: false },
  employee: { ttl: 60_000, isPublic: false },

  // HR System Tables
  hr_candidate: { ttl: 30_000, isPublic: false },
  hr_joining: { ttl: 60_000, isPublic: false },
  hr_attendance: { ttl: 30_000, isPublic: false },
  hr_attendance_claim: { ttl: 30_000, isPublic: false },
  hr_attendance_config: { ttl: 300_000, isPublic: false },
  hr_leave: { ttl: 30_000, isPublic: false },
  hr_gate_pass: { ttl: 30_000, isPublic: false },
  hr_advance_request: { ttl: 30_000, isPublic: false },
  hr_employee_loan: { ttl: 60_000, isPublic: false },
  hr_salary_structure: { ttl: 120_000, isPublic: false },
  hr_payslip: { ttl: 30_000, isPublic: false },
  hr_letter_template: { ttl: 120_000, isPublic: false },
  hr_letter_field_value: { ttl: 120_000, isPublic: false },
  hr_audit_event: { ttl: 60_000, isPublic: false },
  hr_config: { ttl: 300_000, isPublic: false },
};

const DEFAULT_TABLE_TTL = { ttl: 30_000, isPublic: false };

// LRU Query Result Cache
export const queryCache = new LRUCache<string, any>({
  max: 200, // Maximum 200 cached query results
  ttl: 30_000, // Fallback TTL
});

// Dependency map: tables whose caches must be invalidated when a mutation occurs on a linked table
const TABLE_INVALIDATION_DEPENDENCIES: Record<string, string[]> = {
  indent: ['indent', 'inventory', 'pc_report'],
  store_in: ['store_in', 'inventory', 'pc_report'],
  store_in_direct: ['store_in_direct', 'store_in'],
  issue: ['issue', 'inventory', 'pc_report'],
  tally_entry: ['tally_entry', 'pc_report'],
  holiday: ['holiday', 'working_day_calendar'],
  project_assignments: ['project_assignments', 'project_assignment_events'],
  project_assignment_events: ['project_assignment_events'],
  employee: ['employee', 'project_assignments', 'hr_joining', 'hr_leave', 'hr_attendance', 'hr_payslip'],
  hr_candidate: ['hr_candidate', 'hr_joining', 'employee'],
  hr_joining: ['hr_joining', 'hr_candidate', 'employee'],
  hr_attendance: ['hr_attendance', 'hr_payslip'],
  hr_attendance_claim: ['hr_attendance_claim', 'hr_attendance'],
  hr_leave: ['hr_leave', 'hr_attendance'],
  hr_gate_pass: ['hr_gate_pass'],
  hr_advance_request: ['hr_advance_request', 'hr_employee_loan', 'hr_payslip'],
  hr_employee_loan: ['hr_employee_loan', 'hr_advance_request', 'hr_payslip', 'employee'],
  hr_salary_structure: ['hr_salary_structure', 'hr_payslip'],
  hr_payslip: ['hr_payslip'],
  hr_letter_template: ['hr_letter_template', 'hr_letter_field_value'],
  hr_letter_field_value: ['hr_letter_field_value', 'hr_letter_template'],
  hr_audit_event: ['hr_audit_event'],
  hr_config: ['hr_config'],
  group_head: ['group_head', 'item', 'inventory'],
  uom: ['uom', 'item', 'inventory'],
  area_of_use: ['area_of_use', 'indent'],
  firm: ['firm', 'company', 'item', 'vendors', 'contractor_details', 'site_location_details', 'site_engineer_details', 'inventory', 'indent'],
  company: ['company', 'firm'],
  vendors: ['vendors', 'po_master', 'indent', 'store_in'],
  item: ['item', 'inventory', 'indent', 'store_in', 'issue', 'fullkitting'],
  contractor_details: ['contractor_details', 'issue'],
  site_location_details: ['site_location_details', 'issue', 'indent'],
  site_engineer_details: ['site_engineer_details', 'po_master', 'indent'],
  department: ['department', 'indent'],
  default_po_terms: ['default_po_terms', 'terms_and_condition', 'po_master'],
  terms_and_condition: ['terms_and_condition', 'default_po_terms'],
};

/**
 * Invalidate cached query results for the mutated table and its downstream dependencies
 */
export function invalidateTableCache(table: string) {
  const tablesToInvalidate = TABLE_INVALIDATION_DEPENDENCIES[table] || [table];
  const keysToDelete: string[] = [];

  for (const key of queryCache.keys()) {
    for (const t of tablesToInvalidate) {
      if (key.startsWith(`${t}:`)) {
        keysToDelete.push(key);
        break;
      }
    }
  }

  for (const key of keysToDelete) {
    queryCache.delete(key);
  }

  if (keysToDelete.length > 0) {
    console.log(`🧹 [CACHE INVALIDATED] '${table}' mutation purged ${keysToDelete.length} cache key(s) (${tablesToInvalidate.join(', ')})`);
  }
}

export function clearAllQueryCache() {
  queryCache.clear();
  console.log(`🧹 [CACHE INVALIDATED] Cleared entire queryCache.`);
}

/**
 * Helper to attach ETag and Cache-Control headers, and handle 304 Not Modified
 */
function sendCachedResponse(req: Request, res: Response, table: string, responseData: any) {
  // Prevent browser disk/memory caching so frontend always fetches real-time updates immediately,
  // while backend LRU queryCache provides ultra-fast in-memory responses for un-mutated data.
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  // Strong MD5 ETag
  const etag = `"${crypto.createHash('md5').update(JSON.stringify(responseData)).digest('hex')}"`;
  res.setHeader('ETag', etag);

  const ifNoneMatch = req.headers['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === etag) {
    return res.status(304).end();
  }

  return res.json(responseData);
}

// Convert snake_case table name to camelCase Prisma model key
function getModelKey(tableName: string): string {
  const parts = tableName.split('_');
  if (parts.length === 1) return parts[0];
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
}

export async function syncTableSequence(tableName: string, tx?: any) {
  try {
    const db = tx || prisma;
    await db.$executeRawUnsafe(
      `SELECT setval(pg_get_serial_sequence('"${tableName}"', 'id'), COALESCE((SELECT MAX(id) FROM "${tableName}"), 0) + 1, false);`
    );
  } catch (err) {
    console.warn(`Could not sync sequence for table '${tableName}':`, err);
  }
}

export async function syncAllSequences(tx?: any) {
  const db = tx || prisma;
  const tables = [
    'area_of_use', 'company', 'contractor_details', 'default_po_terms',
    'department', 'firm', 'group_head', 'uom', 'item', 'master',
    'payment_history', 'payments', 'pc_report', 'po_master',
    'quotation_history', 'store_in', 'store_in_direct', 'tally_entry',
    'fullkitting', 'indent', 'inventory', 'issue', 'site_location_details',
    'site_engineer_details', 'terms_and_condition', 'vendors', 'working_day_calendar', 'holiday'
  ];

  for (const table of tables) {
    try {
      await db.$executeRawUnsafe(
        `SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false);`
      );
    } catch {
      // Ignore tables without serial sequence
    }
  }
}

function getPrismaModel(tableName: string, client?: any): any {
  const key = getModelKey(tableName);
  const target = client || prisma;
  const model = (target as any)[key];
  if (!model) {
    throw new ApiError(404, `Entity model '${tableName}' (mapped as '${key}') not found`);
  }
  return model;
}

// Map of model name (capitalized/camelCase) -> Map of field name -> { type, kind }
const MODEL_FIELDS_CACHE: Record<string, Record<string, { type: string; kind: string; isRequired: boolean }>> = {};

function getModelFields(tableName: string): Record<string, { type: string; kind: string; isRequired: boolean }> {
  const modelKey = getModelKey(tableName);
  if (MODEL_FIELDS_CACHE[modelKey]) {
    return MODEL_FIELDS_CACHE[modelKey];
  }

  const fieldsMap: Record<string, { type: string; kind: string; isRequired: boolean }> = {};
  const dmmf = Prisma.dmmf || (prisma as any)?._dmmf || (prisma as any)?._baseDmmf;
  const dmmfModels: readonly any[] = dmmf?.datamodel?.models || [];
  let modelDef = dmmfModels.find(
    (m) => m.name.toLowerCase() === modelKey.toLowerCase()
  );

  if (!modelDef) {
    const runtimeModels = (prisma as any)?._runtimeDataModel?.models;
    if (runtimeModels) {
      const matchKey = Object.keys(runtimeModels).find((k) => k.toLowerCase() === modelKey.toLowerCase());
      if (matchKey) {
        const rModel = runtimeModels[matchKey];
        modelDef = {
          fields: Object.entries(rModel.fields || {}).map(([fname, fdef]: [string, any]) => ({
            name: fname,
            type: fdef.type,
            kind: fdef.kind || 'scalar',
            isRequired: !fdef.isOptional && !fdef.isNullable,
          })),
        };
      }
    }
  }

  if (modelDef?.fields) {
    for (const f of modelDef.fields) {
      if (typeof f.type === 'string') {
        fieldsMap[f.name] = {
          type: f.type,
          kind: f.kind || 'scalar',
          isRequired: f.isRequired ?? true,
        };
      }
    }
  }

  MODEL_FIELDS_CACHE[modelKey] = fieldsMap;
  return fieldsMap;
}

/**
 * Cast input value to the appropriate JS / Prisma type according to the field type.
 */
function castValueForField(fieldType: string | undefined, key: string, val: any): any {
  if (val === undefined || val === null) return val;

  if (Array.isArray(val)) {
    if (fieldType === 'String') {
      return val.map((item) => String(item ?? '').trim()).filter(Boolean).join(',');
    }
    return val;
  }

  if (fieldType) {
    switch (fieldType) {
      case 'BigInt':
        if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
          try { return BigInt(val.trim()); } catch { return val; }
        }
        if (typeof val === 'number') {
          return BigInt(Math.floor(val));
        }
        return val;

      case 'Int':
        if (typeof val === 'string' && !isNaN(parseInt(val, 10))) {
          return parseInt(val, 10);
        }
        if (typeof val === 'number') {
          return Math.floor(val);
        }
        return val;

      case 'Float':
      case 'Decimal':
        if (typeof val === 'string' && !isNaN(Number(val))) {
          return parseFloat(val);
        }
        if (typeof val === 'number') {
          return val;
        }
        return val;

      case 'Boolean':
        if (val === 'true' || val === true) return true;
        if (val === 'false' || val === false) return false;
        return val;

      case 'DateTime':
        if (!val || (typeof val === 'string' && val.trim() === '')) {
          return null;
        }
        if (typeof val === 'string') {
          const str = val.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            return new Date(`${str}T00:00:00.000Z`).toISOString();
          }
          const d = new Date(str);
          if (!isNaN(d.getTime())) {
            return d.toISOString();
          }
        }
        return null;

      case 'String':
        if (typeof val !== 'string') {
          return String(val);
        }
        return val;

      default:
        return val;
    }
  }

  // Fallback when field metadata is unavailable
  if (val === 'true') return true;
  if (val === 'false') return false;
  if ((key === 'id' || key.endsWith('_id')) && typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
    try { return BigInt(val.trim()); } catch { return val; }
  }
  return val;
}

function parseWhereFilters(tableName: string, filters: Record<string, any>): Record<string, any> {
  const fieldsMap = getModelFields(tableName);
  const where: Record<string, any> = {};
  // Collects or__colName=value pairs so multiple such keys combine into a single
  // WHERE (col1 = value1 OR col2 = value2 OR ...) instead of each being ANDed separately.
  const orConditions: Record<string, any>[] = [];

  Object.keys(filters).forEach((key) => {
    const rawVal = filters[key];

    if (key.startsWith('not_null__')) {
      // not_null__colName=true → WHERE colName IS NOT NULL
      const col = key.slice(10);
      const fieldDef = fieldsMap[col];
      // Non-nullable columns in Prisma schema can never be null in PostgreSQL.
      // Passing { not: null } on a non-nullable column causes Prisma runtime error "Argument `not` must not be null".
      // Therefore, only add { not: null } if the field is explicitly known to be optional/nullable (isRequired === false).
      if ((rawVal === 'true' || rawVal === true) && fieldDef && fieldDef.isRequired === false) {
        where[col] = { not: null };
      }
    } else if (key.startsWith('is_null__')) {
      // is_null__colName=true → WHERE colName IS NULL
      const col = key.slice(9);
      const fieldDef = fieldsMap[col];
      if ((rawVal === 'true' || rawVal === true) && fieldDef && fieldDef.isRequired === false) {
        where[col] = null;
      }
    } else {
      if (rawVal === undefined || rawVal === null || rawVal === '') return;

      if (key.startsWith('or__')) {
        // or__colName=value → this condition is OR'd together with every other or__ condition
        const col = key.slice(4);
        if (!fieldsMap[col]) return;
        const fieldType = fieldsMap[col]?.type;
        orConditions.push({ [col]: castValueForField(fieldType, col, rawVal) });
      } else if (key.startsWith('in__')) {
        const col = key.slice(4);
        if (!fieldsMap[col]) return;
        const fieldType = fieldsMap[col]?.type;
        const items = String(rawVal).split(',').map((item) => castValueForField(fieldType, col, item.trim()));
        where[col] = { in: items };
      } else if (key.startsWith('neq__')) {
        const col = key.slice(5);
        if (!fieldsMap[col]) return;
        const fieldType = fieldsMap[col]?.type;
        where[col] = { not: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('ilike__')) {
        const col = key.slice(7);
        if (!fieldsMap[col]) return;
        const cleaned = String(rawVal).replace(/%/g, '');
        where[col] = { contains: cleaned, mode: 'insensitive' };
      } else if (key.startsWith('gte__')) {
        const col = key.slice(5);
        if (!fieldsMap[col]) return;
        const fieldType = fieldsMap[col]?.type;
        where[col] = { gte: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('lte__')) {
        const col = key.slice(5);
        if (!fieldsMap[col]) return;
        const fieldType = fieldsMap[col]?.type;
        where[col] = { lte: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('gt__')) {
        const col = key.slice(4);
        if (!fieldsMap[col]) return;
        const fieldType = fieldsMap[col]?.type;
        where[col] = { gt: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('lt__')) {
        const col = key.slice(4);
        if (!fieldsMap[col]) return;
        const fieldType = fieldsMap[col]?.type;
        where[col] = { lt: castValueForField(fieldType, col, rawVal) };
      } else {
        // Only include exact-match filters if the field exists on the Prisma model schema
        if (fieldsMap[key]) {
          const fieldType = fieldsMap[key]?.type;
          where[key] = castValueForField(fieldType, key, rawVal);
        }
      }
    }
  });

  if (orConditions.length > 0) {
    where.OR = orConditions;
  }

  return where;
}

// Normalize all fields in a request body using Prisma model schema metadata
function normalizeBody(tableName: string, body: Record<string, any>): Record<string, any> {
  const fieldsMap = getModelFields(tableName);

  const out: Record<string, any> = {};
  for (const [key, val] of Object.entries(body)) {
    if (val === undefined || val === null) {
      out[key] = val;
      continue;
    }
    const fieldDef = fieldsMap[key];
    const fieldType = fieldDef?.type;
    out[key] = castValueForField(fieldType, key, val);
  }
  return out;
}

// Relations to eagerly include for specific tables (updated with firm relation).
const TABLE_INCLUDES: Record<string, Record<string, any>> = {
  item: { group_head: true, uom: true, firm: true },
  firm: { company: true },
  vendors: { firm: true },
  contractor_details: { firm: true },
  site_location_details: { firm: true },
  site_engineer_details: { firm: true },
  terms_and_condition: { firm: true },
  default_po_terms: { firm: true },
  group_head: { firm: true },
  uom: { firm: true },
  area_of_use: { firm: true },
  inventory: { firm: true },
  po_master: { firm: true },
  payments: { firm: true },
  stock_transfers: { from_firm: true, to_firm: true },
  fullkitting: { firm: true },
};

export class GenericController {
  // GET /api/store/entity/:table
  getEntities = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const model = getPrismaModel(table);
    const fieldsMap = getModelFields(table);

    const { limit, _limit, offset, page, _range, order, select, cursor, cursor_field, q, search, search_fields, ...filters } = req.query;

    const where = parseWhereFilters(table, filters);

    // Database search across fields and relations
    const searchTerm = String(q || search || '').trim();
    if (searchTerm) {
      const searchFieldsList = search_fields && typeof search_fields === 'string'
        ? search_fields.split(',').map((s) => s.trim()).filter(Boolean)
        : Object.keys(fieldsMap).filter((k) => fieldsMap[k]?.type === 'String');

      const searchConditions: any[] = [];
      for (const field of searchFieldsList) {
        if (field.includes('.')) {
          const [relation, relField] = field.split('.');
          if (TABLE_INCLUDES[table]?.[relation] || fieldsMap[relation]) {
            searchConditions.push({
              [relation]: {
                [relField]: { contains: searchTerm, mode: 'insensitive' },
              },
            });
          }
        } else if (fieldsMap[field]) {
          if (fieldsMap[field].type === 'String') {
            searchConditions.push({ [field]: { contains: searchTerm, mode: 'insensitive' } });
          } else if (fieldsMap[field].type === 'Int' || fieldsMap[field].type === 'BigInt') {
            if (/^\d+$/.test(searchTerm)) {
              searchConditions.push({ [field]: Number(searchTerm) });
            }
          }
        }
      }

      // Add common relation searches for entities if search_fields wasn't specifically provided
      if (!search_fields) {
        if (table === 'item') {
          searchConditions.push(
            { group_head: { name: { contains: searchTerm, mode: 'insensitive' } } },
            { uom: { name: { contains: searchTerm, mode: 'insensitive' } } },
            { firm: { firm_name: { contains: searchTerm, mode: 'insensitive' } } }
          );
        } else if (table === 'vendors' || table === 'contractor_details' || table === 'site_location_details' || table === 'site_engineer_details' || table === 'group_head' || table === 'uom' || table === 'area_of_use') {
          searchConditions.push(
            { firm: { firm_name: { contains: searchTerm, mode: 'insensitive' } } }
          );
        } else if (table === 'firm') {
          searchConditions.push(
            { company: { company_name: { contains: searchTerm, mode: 'insensitive' } } }
          );
        }
      }

      if (searchConditions.length > 0) {
        if (where.AND && Array.isArray(where.AND)) {
          where.AND.push({ OR: searchConditions });
        } else if (where.OR) {
          where.AND = [{ OR: where.OR }, { OR: searchConditions }];
          delete where.OR;
        } else {
          where.OR = searchConditions;
        }
      }
    }

    // Keyset / Cursor-based Pagination support (WHERE timestamp < :cursorTs OR (timestamp = :cursorTs AND id < :cursorId))
    if (cursor && typeof cursor === 'string') {
      let cursorObj: any = null;
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
        cursorObj = JSON.parse(decoded);
      } catch {
        if (/^\d+$/.test(cursor)) {
          cursorObj = { id: BigInt(cursor) };
        }
      }

      if (cursorObj) {
        if (cursorObj.timestamp && cursorObj.id && fieldsMap['timestamp']) {
          const cursorTs = new Date(cursorObj.timestamp);
          const cursorId = BigInt(cursorObj.id);
          where.OR = [
            { timestamp: { lt: cursorTs } },
            { timestamp: cursorTs, id: { lt: cursorId } },
          ];
        } else if (cursorObj.id) {
          where.id = { lt: BigInt(cursorObj.id) };
        }
      }
    }

    const queryOptions: any = { where };

    const MAX_LIMIT = 5000;
    const DEFAULT_LIMIT = 100;

    let take: number | undefined;
    let skip: number | undefined;

    if (_range && typeof _range === 'string') {
      const parts = _range.split(',').map((s) => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        skip = parts[0];
        take = Math.min(parts[1] - parts[0] + 1, MAX_LIMIT);
      }
    } else {
      const limitVal = limit || _limit;
      if (limitVal === 'all' || limitVal === '-1' || limitVal === '0') {
        take = 50000;
      } else if (limitVal) {
        take = Math.min(parseInt(limitVal as string, 10) || DEFAULT_LIMIT, MAX_LIMIT);
      } else {
        take = DEFAULT_LIMIT;
      }

      if (offset) {
        skip = parseInt(offset as string, 10);
      } else if (page && take) {
        const pageNum = parseInt(page as string, 10);
        if (pageNum > 0) {
          skip = (pageNum - 1) * take;
        }
      }
    }

    if (take !== undefined && !isNaN(take) && take > 0) {
      // Fetch 1 extra record to reliably determine hasMore without issuing a separate COUNT query
      queryOptions.take = take + 1;
    }
    if (skip !== undefined && !isNaN(skip) && skip >= 0) {
      queryOptions.skip = skip;
    }

    // Compound tiebreaker ordering to guarantee stable keyset pagination
    if (order && typeof order === 'string') {
      const [field, direction] = order.split('.');
      if (field && fieldsMap[field]) {
        const dir = direction === 'desc' ? 'desc' : 'asc';
        queryOptions.orderBy = field !== 'id' ? [{ [field]: dir }, { id: dir }] : [{ id: dir }];
      } else {
        queryOptions.orderBy = [{ id: 'desc' }];
      }
    } else {
      queryOptions.orderBy = [{ id: 'desc' }];
    }

    if (TABLE_INCLUDES[table]) {
      queryOptions.include = TABLE_INCLUDES[table];
    }

    // --- LRU Cache Check ---
    const cacheKey = `${table}:${JSON.stringify(queryOptions)}`;
    const cachedResponse = queryCache.get(cacheKey);
    if (cachedResponse) {
      console.log(`⚡ [CACHE HIT] '${table}' (params: ${JSON.stringify(req.query)})`);
      return sendCachedResponse(req, res, table, cachedResponse);
    }

    console.log(`🔍 [CACHE MISS] '${table}' -> querying DB (params: ${JSON.stringify(req.query)})`);
    const fetchedRecords = await model.findMany(queryOptions);

    const actualTake = take || DEFAULT_LIMIT;
    const hasMore = fetchedRecords.length > actualTake;
    const records = hasMore ? fetchedRecords.slice(0, actualTake) : fetchedRecords;

    let nextCursor: string | null = null;
    if (hasMore && records.length > 0) {
      const lastRecord = records[records.length - 1];
      const cursorPayload: any = { id: lastRecord.id ? String(lastRecord.id) : undefined };
      if (lastRecord.timestamp) {
        cursorPayload.timestamp = lastRecord.timestamp;
      }
      nextCursor = Buffer.from(JSON.stringify(cursorPayload)).toString('base64');
    }

    const responsePayload = {
      success: true,
      data: records,
      hasMore,
      nextCursor,
    };

    const tableConfig = TABLE_TTL_CONFIG[table] || DEFAULT_TABLE_TTL;
    queryCache.set(cacheKey, responsePayload, { ttl: tableConfig.ttl });

    return sendCachedResponse(req, res, table, responsePayload);
  });

  // GET /api/store/entity/:table/:id
  getEntityById = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const id = req.params.id as string;
    const model = getPrismaModel(table);

    // --- LRU Cache Check ---
    const cacheKey = `${table}:id:${id}`;
    const cachedResponse = queryCache.get(cacheKey);
    if (cachedResponse) {
      console.log(`⚡ [CACHE HIT] '${table}/${id}'`);
      return sendCachedResponse(req, res, table, cachedResponse);
    }

    console.log(`🔍 [CACHE MISS] '${table}/${id}' -> querying DB`);
    const numericId = isNaN(Number(id)) ? id : BigInt(id);

    const findOptions: any = {
      where: { id: numericId },
    };

    if (TABLE_INCLUDES[table]) {
      findOptions.include = TABLE_INCLUDES[table];
    }

    const record = await model.findUnique(findOptions);

    if (!record) {
      throw new ApiError(404, `Record with ID '${id}' not found in '${table}'`);
    }

    const responsePayload = {
      success: true,
      data: record,
    };

    const tableConfig = TABLE_TTL_CONFIG[table] || DEFAULT_TABLE_TTL;
    queryCache.set(cacheKey, responsePayload, { ttl: tableConfig.ttl });

    return sendCachedResponse(req, res, table, responsePayload);
  });

  // POST /api/store/entity/:table
  createEntity = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const body = req.body;

    const seqService = new SequenceService();
    const inventoryService = new InventoryStockService();
    const pcReportService = new PcReportService();

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const model = getPrismaModel(table, tx);

      const processCreateItem = async (item: any) => {
        const data = normalizeBody(table, { ...item });
        delete data.id;
        if (data.active === undefined && (table === 'firm' || table === 'default_po_terms')) {
          data.active = true;
        }

        // Pre-Mutation Hooks (Sequence Generation & Date Planning)
        if (table === 'indent') {
          if (!data.timestamp) data.timestamp = new Date();
          if (!data.planned1) data.planned1 = new Date(data.timestamp);
          if (!data.indent_number || data.indent_number === '') {
            data.indent_number = await seqService.generateIndentNumber(tx);
          }
        } else if (table === 'store_in') {
          if (!data.timestamp) data.timestamp = new Date();
          if (!data.planned6) {
            data.planned6 = SchedulePlannerService.generatePlanned6(data.timestamp, tx);
          }
          if (!data.planned11 && data.bill_status) {
            data.planned11 = SchedulePlannerService.generatePlanned11(data.bill_status, data.timestamp, tx);
          }
          if (!data.lift_number || data.lift_number === '') {
            data.lift_number = await seqService.generateLiftNumber(tx);
          }
        } else if (table === 'issue') {
          if (!data.issue_no || data.issue_no === '') {
            data.issue_no = await seqService.generateIssueNo(tx);
          }
        }

        // Main Mutation inside transaction with sequence sync retry
        let created: any;
        try {
          created = await model.create({ data });
        } catch (err: any) {
          const isIdUniqueError =
            err?.code === 'P2002' ||
            String(err?.message || '').includes('id') ||
            String(err?.message || '').includes('Unique constraint');

          if (isIdUniqueError) {
            console.warn(`⚠️ ID constraint failure on '${table}'. Syncing PostgreSQL sequence and retrying...`);
            await syncTableSequence(table, tx);
            created = await model.create({ data });
          } else {
            throw err;
          }
        }

        // Post-Mutation Hooks (passing tx to all service calls)
        if (table === 'indent') {
          if (created?.product_name) {
            await inventoryService.syncInventoryItemAggregations(created.product_name, tx);
          }
          await pcReportService.recalculateStageKpis('Should Need Offer Or Regular', tx);
        } else if (table === 'store_in') {
          const delays = DelayCalculatorService.calculateStoreInDelays(created, tx);
          const hasDelays = Object.values(delays).some((v) => v !== null);
          let finalRecord = created;
          if (hasDelays) {
            finalRecord = await model.update({
              where: { id: created.id },
              data: delays,
            });
          }
          if (finalRecord?.product_name) {
            await inventoryService.syncInventoryItemAggregations(finalRecord.product_name, tx);
          }
          if (finalRecord?.indent_no) {
            await inventoryService.calculatePendingLiftQty(finalRecord.indent_no, tx);
          }
          await pcReportService.recalculateStageKpis('Received In Store', tx);
        } else if (table === 'issue') {
          const delays = DelayCalculatorService.calculateIssueDelays(created, tx);
          const hasDelays = Object.values(delays).some((v) => v !== null);
          let finalRecord = created;
          if (hasDelays) {
            finalRecord = await model.update({
              where: { id: created.id },
              data: delays,
            });
          }
          if (finalRecord?.product_name) {
            await inventoryService.syncInventoryItemAggregations(finalRecord.product_name, tx);
          }
          await pcReportService.recalculateStageKpis('Issue Data', tx);
        } else if (table === 'tally_entry') {
          const delays = DelayCalculatorService.calculateTallyEntryDelays(created, tx);
          const hasDelays = Object.values(delays).some((v) => v !== null);
          let finalRecord = created;
          if (hasDelays) {
            finalRecord = await model.update({
              where: { id: created.id },
              data: delays,
            });
          }
          await pcReportService.recalculateStageKpis('Audit Data', tx);
        } else if (table === 'holiday') {
          if (created?.holiday_date) {
            const hDate = new Date(created.holiday_date);
            await tx.workingDayCalendar.deleteMany({
              where: { working_date: hDate },
            });
          }
        }

        return created;
      };

      if (Array.isArray(body)) {
        const createdItems = [];
        for (const item of body) {
          createdItems.push(await processCreateItem(item));
        }
        return createdItems;
      } else {
        return await processCreateItem(body);
      }
    });

    // Invalidate cached query results for the mutated table and dependencies
    invalidateTableCache(table);

    res.status(201).json({
      success: true,
      data: result,
    });
  });

  // PATCH / PUT /api/store/entity/:table/:id
  updateEntityById = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const id = req.params.id as string;
    const body = req.body;

    const inventoryService = new InventoryStockService();
    const pcReportService = new PcReportService();

    const numericId = isNaN(Number(id)) ? id : BigInt(id);
    const data = normalizeBody(table, body);

    const updated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const model = getPrismaModel(table, tx);

      // Pre-Mutation Hooks (State machine transitions, planned date additions & delay calculations)
      if (table === 'indent') {
        const existing = await model.findUnique({ where: { id: numericId } });
        if (existing) {
          const merged = { ...existing, ...data };

          // Stage 1 approval (actual1)
          if (data.actual1 && !existing.actual1) {
            data.time_delay1 = DelayCalculatorService.calculateDelay(data.actual1, merged.planned1, tx);
            if (!data.planned2) {
              data.planned2 = SchedulePlannerService.skipSunday(new Date(data.actual1), tx);
            }
          }
          // Stage 2 rate update (actual2)
          if (data.actual2 && !existing.actual2) {
            data.time_delay2 = DelayCalculatorService.calculateDelay(data.actual2, merged.planned2, tx);
            if (!data.planned3) {
              data.planned3 = SchedulePlannerService.skipSunday(new Date(data.actual2), tx);
            }
          }
          // Stage 3 technical approval (actual3)
          if (data.actual3 && !existing.actual3) {
            data.time_delay3 = DelayCalculatorService.calculateDelay(data.actual3, merged.planned3, tx);
            if (!data.planned4) {
              data.planned4 = SchedulePlannerService.generatePlanned4(
                merged.vendor_type || 'Three Party',
                merged.actual2,
                data.actual3,
                tx
              );
            }
          }
          // Stage 4 PO creation (actual4)
          if (data.actual4 && !existing.actual4) {
            data.time_delay4 = DelayCalculatorService.calculateDelay(data.actual4, merged.planned4, tx);
            if (!data.planned5) {
              data.planned5 = SchedulePlannerService.skipSunday(new Date(data.actual4), tx);
            }
          }
          // Stage 5 payment terms (actual5)
          if (data.actual5 && !existing.actual5) {
            data.time_delay = DelayCalculatorService.calculateDelay(data.actual5, merged.planned5, tx);
            if (!data.planned7) {
              data.planned7 = SchedulePlannerService.generatePlanned7(data.actual5, merged.payment_term, tx);
            }
          }
        }
      } else if (table === 'tally_entry') {
        const existing = await model.findUnique({ where: { id: numericId } });
        if (existing) {
          const plannedUpdates = SchedulePlannerService.calculateTallyWorkflowPlannedDates(existing, data, tx);
          Object.assign(data, plannedUpdates);

          const delays = DelayCalculatorService.calculateTallyEntryDelays({ ...existing, ...data }, tx);
          Object.assign(data, delays);
        }
      } else if (table === 'store_in') {
        const existing = await model.findUnique({ where: { id: numericId } });
        if (existing) {
          const delays = DelayCalculatorService.calculateStoreInDelays({ ...existing, ...data }, tx);
          Object.assign(data, delays);
        }
      } else if (table === 'issue') {
        const existing = await model.findUnique({ where: { id: numericId } });
        if (existing) {
          const delays = DelayCalculatorService.calculateIssueDelays({ ...existing, ...data }, tx);
          Object.assign(data, delays);
        }
      }

      // Main Mutation inside transaction
      const updatedRecord = await model.update({
        where: { id: numericId },
        data: data,
      });

      // Post-Mutation Hooks (passing tx to all service calls)
      if (table === 'indent') {
        if (updatedRecord?.product_name) {
          await inventoryService.syncInventoryItemAggregations(updatedRecord.product_name, tx);
        }
        await pcReportService.recalculateStageKpis('Should Need Offer Or Regular', tx);
        await pcReportService.recalculateStageKpis('Reguler Or Need Offer Rate Update', tx);
        await pcReportService.recalculateStageKpis('Approval And Rejection For Purchase', tx);
        await pcReportService.recalculateStageKpis('PO WebApp', tx);
        await pcReportService.recalculateStageKpis('Material Lifting', tx);
      } else if (table === 'store_in') {
        if (updatedRecord?.product_name) {
          await inventoryService.syncInventoryItemAggregations(updatedRecord.product_name, tx);
        }
        if (updatedRecord?.indent_no) {
          await inventoryService.calculatePendingLiftQty(updatedRecord.indent_no, tx);
        }
        await pcReportService.recalculateStageKpis('Received In Store', tx);
        await pcReportService.recalculateStageKpis('Quality Check In Received Item', tx);
        await pcReportService.recalculateStageKpis('Send Debit Note', tx);
      } else if (table === 'issue') {
        if (updatedRecord?.product_name) {
          await inventoryService.syncInventoryItemAggregations(updatedRecord.product_name, tx);
        }
        await pcReportService.recalculateStageKpis('Issue Data', tx);
      } else if (table === 'tally_entry') {
        await pcReportService.recalculateStageKpis('Audit Data', tx);
        await pcReportService.recalculateStageKpis('Rectify the mistake', tx);
        await pcReportService.recalculateStageKpis('Reaudit Data', tx);
        await pcReportService.recalculateStageKpis('Take Entry By Tally', tx);
        await pcReportService.recalculateStageKpis('Again Audit', tx);
      }

      return updatedRecord;
    });

    // Invalidate cached query results for the mutated table and dependencies
    invalidateTableCache(table);

    res.json({
      success: true,
      data: updated,
    });
  });

  // PATCH / api / store / entity /: table(bulk update with filters)
  updateEntities = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const { where = {}, data = {} } = req.body;

    const normalizedData = normalizeBody(table, data);
    const normalizedWhere = parseWhereFilters(table, where);

    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const model = getPrismaModel(table, tx);
      return await model.updateMany({
        where: normalizedWhere,
        data: normalizedData,
      });
    });

    // Invalidate cached query results for the mutated table and dependencies
    invalidateTableCache(table);

    res.json({
      success: true,
      data: result,
    });
  });

  // DELETE /api/store/entity/:table/:id
  deleteEntityById = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const id = req.params.id as string;

    const numericId = isNaN(Number(id)) ? id : BigInt(id);

    const inventoryService = new InventoryStockService();

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const model = getPrismaModel(table, tx);

      // Save record BEFORE delete so we can use product_name in post-delete hooks
      let recordBeforeDelete: any = null;
      if (table === 'issue' || table === 'indent' || table === 'store_in') {
        try {
          recordBeforeDelete = await model.findUnique({ where: { id: numericId } });
        } catch (_) {}
      }

      if (table === 'holiday') {
        const existing = await model.findUnique({ where: { id: numericId } });
        if (existing?.holiday_date) {
          const hDate = new Date(existing.holiday_date);
          const dayNames = ['रवि', 'सोम', 'मंगल', 'बुध', 'गुरु', 'शुक्र', 'शनि'];
          const dow = hDate.getUTCDay();
          const weekNum = Math.ceil(hDate.getUTCDate() / 7);
          const monthNum = hDate.getUTCMonth() + 1;

          await tx.workingDayCalendar.create({
            data: {
              working_date: hDate,
              day: dayNames[dow],
              week_num: weekNum,
              month: monthNum,
            },
          });
        }
      }

      await model.delete({
        where: { id: numericId },
      });

      // Post-Delete Inventory Sync Hook — mirrors the create/update hooks above
      if (
        (table === 'issue' || table === 'indent' || table === 'store_in') &&
        recordBeforeDelete?.product_name
      ) {
        await inventoryService.syncInventoryItemAggregations(recordBeforeDelete.product_name, tx);
      }
    });

    // Invalidate cached query results for the mutated table and dependencies
    invalidateTableCache(table);

    res.json({
      success: true,
      message: `Record '${id}' deleted from '${table}'`,
    });
  });
}
