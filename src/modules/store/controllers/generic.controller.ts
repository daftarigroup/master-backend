import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { SequenceService } from '../services/sequence.service';
import { SchedulePlannerService } from '../services/schedulePlanner.service';
import { DelayCalculatorService } from '../services/delayCalculator.service';
import { InventoryStockService } from '../services/inventoryStock.service';
import { PcReportService } from '../services/pcReport.service';

// Convert snake_case table name to camelCase Prisma model key
function getModelKey(tableName: string): string {
  const parts = tableName.split('_');
  if (parts.length === 1) return parts[0];
  return parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
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
          kind: f.kind,
          isRequired: f.isRequired ?? (!f.isNullable && !f.isOptional),
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
          return BigInt(val);
        }
        return val;

      case 'Int':
        if (typeof val === 'string' && /^-?\d+$/.test(val.trim())) {
          return parseInt(val.trim(), 10);
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
        if (typeof val === 'string' && val.trim() !== '') {
          const str = val.trim();
          if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
            return new Date(`${str}T00:00:00.000Z`).toISOString();
          }
          const d = new Date(str);
          if (!isNaN(d.getTime())) {
            return d.toISOString();
          }
        }
        return val;

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

      if (key.startsWith('in__')) {
        const col = key.slice(4);
        const fieldType = fieldsMap[col]?.type;
        const items = String(rawVal).split(',').map((item) => castValueForField(fieldType, col, item.trim()));
        where[col] = { in: items };
      } else if (key.startsWith('neq__')) {
        const col = key.slice(5);
        const fieldType = fieldsMap[col]?.type;
        where[col] = { not: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('ilike__')) {
        const col = key.slice(7);
        const cleaned = String(rawVal).replace(/%/g, '');
        where[col] = { contains: cleaned, mode: 'insensitive' };
      } else if (key.startsWith('gte__')) {
        const col = key.slice(5);
        const fieldType = fieldsMap[col]?.type;
        where[col] = { gte: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('lte__')) {
        const col = key.slice(5);
        const fieldType = fieldsMap[col]?.type;
        where[col] = { lte: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('gt__')) {
        const col = key.slice(4);
        const fieldType = fieldsMap[col]?.type;
        where[col] = { gt: castValueForField(fieldType, col, rawVal) };
      } else if (key.startsWith('lt__')) {
        const col = key.slice(4);
        const fieldType = fieldsMap[col]?.type;
        where[col] = { lt: castValueForField(fieldType, col, rawVal) };
      } else {
        const fieldType = fieldsMap[key]?.type;
        where[key] = castValueForField(fieldType, key, rawVal);
      }
    }
  });

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
};

export class GenericController {
  // GET /api/store/entity/:table
  getEntities = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const model = getPrismaModel(table);

    const { limit, _limit, offset, page, _range, order, select, ...filters } = req.query;

    const where = parseWhereFilters(table, filters);
    const queryOptions: any = { where };

    let take: number | undefined;
    let skip: number | undefined;

    if (_range && typeof _range === 'string') {
      const parts = _range.split(',').map((s) => parseInt(s.trim(), 10));
      if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        skip = parts[0];
        take = parts[1] - parts[0] + 1;
      }
    } else {
      const limitVal = limit || _limit;
      if (limitVal) {
        take = parseInt(limitVal as string, 10);
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
      queryOptions.take = take;
    }
    if (skip !== undefined && !isNaN(skip) && skip >= 0) {
      queryOptions.skip = skip;
    }

    if (order && typeof order === 'string') {
      const [field, direction] = order.split('.');
      if (field) {
        queryOptions.orderBy = { [field]: direction === 'desc' ? 'desc' : 'asc' };
      }
    }

    if (TABLE_INCLUDES[table]) {
      queryOptions.include = TABLE_INCLUDES[table];
    }

    const records = await model.findMany(queryOptions);

    res.json({
      success: true,
      data: records,
    });
  });

  // GET /api/store/entity/:table/:id
  getEntityById = asyncHandler(async (req: Request, res: Response) => {
    const table = req.params.table as string;
    const id = req.params.id as string;
    const model = getPrismaModel(table);

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

    res.json({
      success: true,
      data: record,
    });
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

        // Main Mutation inside transaction
        const created = await model.create({ data });

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

    res.json({
      success: true,
      data: updated,
    });
  });

  // PATCH /api/store/entity/:table (bulk update with filters)
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

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const model = getPrismaModel(table, tx);
      await model.delete({
        where: { id: numericId },
      });
    });

    res.json({
      success: true,
      message: `Record '${id}' deleted from '${table}'`,
    });
  });
}
