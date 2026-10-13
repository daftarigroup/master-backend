import { DieselLogSource, DieselRateSource, Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { assertFirmWritable, firmWhere } from '../../../utils/firmScope';
import { toIstDateString } from '../lib/istDate';
import { round2 } from '../lib/usageRules';
import { D } from '../cost/decimal';
import { valuationFor, valueAt } from '../cost/dieselValuation';
import { assertWbsUsable } from './wbs.service';
import { Db, Warning, num, pageOf, requireUserId, scopeOf } from './common';

export interface RecordIssueInput {
  firmId: bigint;
  /** A machine, or a free-text `consumerLabel` for "other diesel". Exactly one is required. */
  machineId?: string | null;
  consumerLabel?: string | null;
  issuedAt: Date;
  litres: number | string;
  source?: DieselLogSource;
  /** Idempotency key. The Store issue hook passes STORE_ISSUE_DIESEL_<issue id> here. */
  externalRef?: string | null;
  note?: string | null;
  createdById: bigint;
  usageLogId?: string | null;
  siteLocationId?: bigint | null;
  wbsActivityId?: string | null;
  /** Explicit price. The Store hook will pass its own rate with rateSource STORE; an admin may pass a MANUAL one. Otherwise the receipt average / firm default is stamped. */
  ratePerLitre?: number | string | null;
  rateSource?: DieselRateSource | null;
  /** fleet_v6_store_diesel: the spot meter reading given on a Store issue, review flags, and the Store issue the log came from. */
  meterReading?: number | string | null;
  flags?: string[];
  storeIssueId?: bigint | null;
}

export interface RecordIssueResult {
  log: Prisma.DieselLogGetPayload<object>;
  /** false when `externalRef` already existed and the existing row was returned. */
  created: boolean;
  warnings: Warning[];
}

/**
 * The single write path for diesel issued to a consumer. The HTTP route, Daily Entry and (later)
 * the Store issue page all come through here; the Store will pass source STORE_ISSUE and an
 * externalRef. This function trusts its caller on authorisation (route handlers check firm access
 * first) but enforces every data rule itself.
 *
 * Idempotent on `externalRef` without aborting an enclosing transaction (a plain unique-violation
 * would poison it in Postgres), so it is safe to call from inside another service's transaction.
 */
export async function recordIssue(input: RecordIssueInput, db: Db = prisma): Promise<RecordIssueResult> {
  const litres = round2(Number(input.litres));
  if (!Number.isFinite(litres) || litres <= 0) throw ApiError.badRequest('litres must be greater than zero');
  if (litres > 99_999_999.99) throw ApiError.badRequest('litres is too large');

  const label = input.consumerLabel?.trim() || null;
  if (!input.machineId && !label) throw ApiError.badRequest('Give a machine, or a label for "other diesel"');
  if (input.machineId && label) throw ApiError.badRequest('Give either a machine or a label, not both');

  const warnings: Warning[] = [];
  if (input.machineId) {
    const machine = await db.machine.findUnique({ where: { id: input.machineId } });
    if (!machine) throw ApiError.badRequest('Unknown machine');
    if (machine.firmId !== null && machine.firmId !== input.firmId) {
      throw ApiError.badRequest('This machine belongs to a different firm');
    }
    if (machine.ownershipType === 'RENTED' && machine.hireType === 'WET') {
      warnings.push({ code: 'WET_HIRE', message: 'This is a wet-hire machine: the vendor normally supplies its diesel.' });
    }
    if (machine.rentalEndAt && machine.rentalEndAt.getTime() < input.issuedAt.getTime()) {
      warnings.push({ code: 'HIRE_ENDED', message: 'The hire of this machine ended before this date.' });
    }
    if (machine.status === 'DECOMMISSIONED') {
      warnings.push({ code: 'DECOMMISSIONED', message: 'This machine is decommissioned.' });
    }
  }

  await assertWbsUsable(db, input.firmId, input.wbsActivityId);

  const row = {
    firmId: input.firmId,
    siteLocationId: input.siteLocationId ?? null,
    machineId: input.machineId ?? null,
    consumerLabel: label,
    usageLogId: input.usageLogId ?? null,
    issuedAt: input.issuedAt,
    issueDate: new Date(toIstDateString(input.issuedAt)),
    litres,
    source: input.source ?? 'MANUAL',
    externalRef: input.externalRef ?? null,
    note: input.note ?? null,
    createdById: input.createdById,
    wbsActivityId: input.wbsActivityId ?? null,
    meterReading: input.meterReading !== null && input.meterReading !== undefined && input.meterReading !== '' ? round2(Number(input.meterReading)) : null,
    flags: input.flags ?? [],
    storeIssueId: input.storeIssueId ?? null,
  } satisfies Prisma.DieselLogUncheckedCreateInput;

  // The value is stamped when the issue is written, so a later receipt price never rewrites history. Null = not priced yet.
  const stamp = async () => {
    const v =
      input.ratePerLitre !== null && input.ratePerLitre !== undefined
        ? valueAt(D(litres), D(input.ratePerLitre), input.rateSource ?? 'MANUAL')
        : await valuationFor(db, { firmId: input.firmId, issueDate: toIstDateString(input.issuedAt), litres: D(litres) });
    return v ? { ratePerLitre: v.ratePerLitre, amount: v.amount, rateSource: v.rateSource } : {};
  };

  if (row.externalRef) {
    const existing = await db.dieselLog.findUnique({ where: { externalRef: row.externalRef } });
    if (existing) return { log: existing, created: false, warnings };
    const res = await db.dieselLog.createMany({ data: [{ ...row, ...(await stamp()) }], skipDuplicates: true });
    const log = await db.dieselLog.findUniqueOrThrow({ where: { externalRef: row.externalRef } });
    return { log, created: res.count === 1, warnings };
  }

  const log = await db.dieselLog.create({ data: { ...row, ...(await stamp()) } });
  return { log, created: true, warnings };
}

export interface CreateIssueBody {
  firmId?: bigint | null;
  machineId?: string | null;
  consumerLabel?: string | null;
  issuedAt: Date;
  litres: number;
  note?: string | null;
  siteLocationId?: bigint | null;
  wbsActivityId?: string | null;
  ratePerLitre?: number | null;
}

export const dieselLogService = {
  async list(
    ctx: UserAuthContext,
    q: { firmId?: unknown; machineId?: string; q?: string; from?: string; to?: string; includeVoided?: boolean; limit?: number; offset?: number },
  ) {
    const search = q.q?.trim();
    const searchFilter: Prisma.DieselLogWhereInput = search
      ? {
          OR: [
            { machine: { name: { contains: search, mode: 'insensitive' } } },
            { machine: { assetCode: { contains: search, mode: 'insensitive' } } },
            { machine: { registrationNo: { contains: search, mode: 'insensitive' } } },
            { consumerLabel: { contains: search, mode: 'insensitive' } },
            { note: { contains: search, mode: 'insensitive' } },
            { storeIssue: { constructor_name: { contains: search, mode: 'insensitive' } } },
            { storeIssue: { issue_person_name: { contains: search, mode: 'insensitive' } } },
            { storeIssue: { issue_to: { contains: search, mode: 'insensitive' } } },
            { usageLog: { operator: { name: { contains: search, mode: 'insensitive' } } } },
          ],
        }
      : {};

    const where: Prisma.DieselLogWhereInput = {
      ...firmWhere(scopeOf(ctx, q.firmId)),
      ...(q.machineId ? { machineId: q.machineId } : {}),
      ...(q.from || q.to
        ? { issueDate: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
      ...(q.includeVoided ? {} : { voidedAt: null }),
      ...searchFilter,
    };
    const { take, skip } = pageOf(q);
    const [rows, total] = await Promise.all([
      prisma.dieselLog.findMany({
        where,
        orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }],
        take,
        skip,
        include: {
          machine: { select: { id: true, name: true, assetCode: true, registrationNo: true, equipmentType: true, ownershipType: true } },
          firm: { select: { id: true, firm_name: true } },
          siteLocation: { select: { id: true, location: true } },
          storeIssue: { select: { id: true, issue_no: true, issue_person_name: true, issue_to: true, constructor_name: true } },
          usageLog: { select: { id: true, operator: { select: { id: true, name: true } } } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
      prisma.dieselLog.count({ where }),
    ]);
    return {
      total,
      rows: rows.map((r) => ({
        id: r.id,
        firmId: String(r.firmId),
        firmName: r.firm?.firm_name ?? '',
        siteLocation: r.siteLocation?.location ?? null,
        machineId: r.machineId,
        machineName: r.machine?.name ?? null,
        assetCode: r.machine?.assetCode ?? null,
        registrationNo: r.machine?.registrationNo ?? null,
        equipmentType: r.machine?.equipmentType ?? null,
        ownershipType: r.machine?.ownershipType ?? null,
        consumerLabel: r.consumerLabel,
        usageLogId: r.usageLogId,
        issuedAt: r.issuedAt.toISOString(),
        issueDate: toIstDateString(r.issuedAt),
        litres: num(r.litres),
        meterReading: r.meterReading !== null && r.meterReading !== undefined ? num(r.meterReading) : null,
        flags: r.flags ?? [],
        operator: r.usageLog?.operator?.name ?? r.storeIssue?.constructor_name ?? null,
        issuedBy: r.storeIssue?.issue_person_name ?? r.createdBy?.name ?? null,
        source: r.source,
        ratePerLitre: r.ratePerLitre !== null && r.ratePerLitre !== undefined ? num(r.ratePerLitre) : null,
        amount: r.amount !== null && r.amount !== undefined ? num(r.amount) : null,
        externalRef: r.externalRef,
        note: r.note,
        voidedAt: r.voidedAt?.toISOString() ?? null,
        voidReason: r.voidReason,
      })),
    };
  },

  async void(ctx: UserAuthContext, id: string, reason: string) {
    const userId = requireUserId(ctx);
    const row = await prisma.dieselLog.findFirst({ where: { id, ...firmWhere(scopeOf(ctx)) } });
    if (!row) throw ApiError.notFound('Diesel entry not found');
    assertFirmWritable(ctx, row.firmId);
    if (row.voidedAt) throw ApiError.conflict('Already voided');
    if (row.source === 'STORE_ISSUE') throw ApiError.conflict('Store-issued diesel is voided from the Store, not here');
    await prisma.dieselLog.update({ where: { id }, data: { voidedAt: new Date(), voidedById: userId, voidReason: reason } });
    return { id, voided: true };
  },
};
