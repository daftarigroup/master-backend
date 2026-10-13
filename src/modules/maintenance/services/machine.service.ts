import { Prisma } from '@prisma/client';
import { prisma } from '../../../database/prisma';
import { ApiError } from '../../../utils/ApiError';
import { UserAuthContext } from '../../../utils/currentUser';
import { isForeignKeyViolation } from '../../../utils/dbErrors';
import { NO_FIRM, assertFirmWritable, parseFirmId } from '../../../utils/firmScope';
import { documentSequenceService } from '../../../services/documentSequence.service';
import { defaultReadingUnit } from '../../fleet/lib/equipment';
import { MACHINE_INCLUDE, machineRepository } from '../repositories/machine.repository';
import { machineMapper } from './machine.mapper';
import { documentService } from '../../fleet/services/document.service';
import { parsePagination, paginationMeta } from './mapUtils';

// Who can see a machine. SUPER_ADMIN sees all. Everyone else sees machines in their permitted firms, plus
// machines that belong to no firm (kept visible because the existing UI always showed them; a firm-less
// machine can only be written to by a SUPER_ADMIN). This is stricter than before, when the server did no
// scoping at all and the browser filtered.
export function machineVisibility(ctx: UserAuthContext): Prisma.MachineWhereInput {
  if (ctx.role === 'SUPER_ADMIN') return {};
  const firms = ctx.permittedFirms.length > 0 ? ctx.permittedFirms : [NO_FIRM];
  return {
    OR: [
      { firmId: { in: firms } },
      { assignments: { some: { endedAt: null, firmId: { in: firms } } } },
      { firmId: null },
    ],
  };
}

function isVisible(ctx: UserAuthContext, machine: { firmId: bigint | null; assignments?: { endedAt?: Date | null; firmId: bigint }[] }) {
  if (ctx.role === 'SUPER_ADMIN' || machine.firmId === null) return true;
  if (ctx.permittedFirms.includes(machine.firmId)) return true;
  return machine.assignments?.some((a) => (!a.endedAt || a.endedAt === null) && ctx.permittedFirms.includes(a.firmId)) ?? false;
}

/** Write access: a machine in a firm needs that firm; a firm-less machine is SUPER_ADMIN only. */
function assertWritable(ctx: UserAuthContext, machine: { firmId: bigint | null }) {
  if (machine.firmId !== null) return assertFirmWritable(ctx, machine.firmId);
  if (ctx.role !== 'SUPER_ADMIN') throw ApiError.forbidden('Only a super admin can change a machine that has no firm');
}

const RENTED_FORBIDDEN = ['purchaseDate', 'purchasePrice', 'installationDate', 'warrantyExpiry', 'warrantyExpiration', 'supplier', 'vendor'] as const;

export const machineService = {
  async list(query: Record<string, any>, ctx: UserAuthContext) {
    const { page, limit, skip } = parsePagination(query);
    const firmId = parseFirmId(query.firmId ?? query.projectId); // 'all' / junk -> no filter (was a 500)
    const departmentId = parseFirmId(query.departmentId);
    const and: Prisma.MachineWhereInput[] = [machineVisibility(ctx)];
    if (query.search) {
      and.push({
        OR: [
          { name: { contains: query.search, mode: 'insensitive' } },
          { assetCode: { contains: query.search, mode: 'insensitive' } },
          { serialNumber: { contains: query.search, mode: 'insensitive' } },
          { registrationNo: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }
    const where: Prisma.MachineWhereInput = {
      AND: and,
      ...(firmId !== null
        ? {
            OR: [
              { firmId },
              { assignments: { some: { endedAt: null, firmId } } },
            ],
          }
        : {}),
      ...(departmentId !== null ? { departmentId } : {}),
      ...(query.assetId ? { assetId: query.assetId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.ownershipType ? { ownershipType: query.ownershipType } : {}),
      ...(query.equipmentType ? { equipmentType: query.equipmentType } : {}),
      ...(query.needMaintenance === 'true' ? { status: { in: ['UNDER_MAINTENANCE', 'BREAKDOWN'] } } : {}),
    };

    const [rows, total] = await Promise.all([machineRepository.findMany(where, skip, limit), machineRepository.count(where)]);
    return { data: rows.map(machineMapper.toDTO), pagination: paginationMeta(page, limit, total) };
  },

  async getById(id: string, ctx: UserAuthContext) {
    const row = await machineRepository.findById(id);
    if (!row || !isVisible(ctx, row)) throw ApiError.notFound('Machine not found');
    return machineMapper.toDTO(row);
  },

  // Creating a machine also registers a matching Asset (category MACHINERY), mirroring the frontend mock's
  // `mockMaintenanceStore.createMachine()` behavior — see ASSET_MAINTENANCE_REPAIR_SCHEMA_ARCHITECTURE.md.
  // `Machine.assetId` is the real FK the fuzzy string-matching in that mock was standing in for.
  // The ownership type is mirrored onto the Asset; a hired machine is not maintenance-tracked.
  async create(body: Record<string, any>, ctx: UserAuthContext) {
    const ownershipType: 'OWNED' | 'RENTED' = body.ownershipType ?? 'OWNED';
    const firmId: bigint | null = (body.firmId ?? body.projectId ?? null) as bigint | null;
    if (firmId !== null) assertFirmWritable(ctx, firmId);
    else if (ctx.role !== 'SUPER_ADMIN' && ownershipType === 'RENTED') throw ApiError.badRequest('firmId is required for a hired machine');

    if (body.rentalVendorId) {
      const vendor = await prisma.repairVendor.findUnique({ where: { id: body.rentalVendorId }, select: { name: true } });
      if (!vendor) throw ApiError.badRequest('Unknown vendor');
      body.rentalVendorName = body.rentalVendorName ?? vendor.name;
    }

    if (body.siteLocationId && firmId) {
      const site = await prisma.siteLocationDetails.findFirst({
        where: { id: BigInt(body.siteLocationId), firm_id: firmId },
        select: { id: true, location: true },
      });
      if (!site) throw ApiError.badRequest('That site does not belong to this firm');
      body.location = body.location ?? site.location;
    }

    // Reading basis: explicit unit wins; otherwise from the equipment type; otherwise HOURS (the old behaviour,
    // and what machines created by the existing form keep getting).
    const equipmentType = body.equipmentType ?? 'OTHER';
    const readingUnit = body.readingUnit ?? (body.equipmentType ? defaultReadingUnit(body.equipmentType) : 'HOURS');
    const openingReading = readingUnit === 'NONE' ? 0 : body.openingReading ?? 0;

    return prisma.$transaction(async (tx) => {
      let assetCode: string | undefined = body.assetCode?.trim();
      if (assetCode) {
        const clash = await tx.machine.findUnique({ where: { assetCode } });
        if (clash) throw ApiError.conflict(`assetCode "${assetCode}" is already in use`);
      } else {
        assetCode = await documentSequenceService.next({ prefix: 'SN', year: 0, pad: 4 }, tx);
      }

      const asset = await tx.asset.create({
        data: {
          assetCode,
          firmId,
          productName: body.name,
          category: 'MACHINERY',
          type: 'ASSET',
          brand: body.manufacturer ?? null,
          model: body.modelNumber ?? null,
          serialNo: body.registrationNo ?? body.serialNumber ?? null,
          location: body.location ?? null,
          status: 'ACTIVE',
          ownershipType,
          maintenanceRequired: ownershipType === 'OWNED',
        },
      });

      const machineData = machineMapper.toPrismaCreate(body);
      const machine = await tx.machine.create({
        data: {
          ...machineData,
          assetCode,
          assetId: asset.id,
          ownershipType,
          equipmentType,
          readingUnit,
          openingReading,
          expectedConsumption: body.expectedConsumption ?? null,
          maxUsagePerEntry: body.maxUsagePerEntry ?? null,
          registrationNo: body.registrationNo ?? null,
          capacityLabel: body.capacityLabel ?? null,
          rentalStartAt: ownershipType === 'RENTED' ? body.rentalStartAt ?? null : null,
          rentalEndAt: ownershipType === 'RENTED' ? body.rentalEndAt ?? null : null,
          rentalVendorId: ownershipType === 'RENTED' ? body.rentalVendorId ?? null : null,
          rentalVendorName: ownershipType === 'RENTED' ? body.rentalVendorName ?? null : null,
          hireType: ownershipType === 'RENTED' ? body.hireType ?? 'DRY' : null,
        },
        include: MACHINE_INCLUDE,
      });

      if (Array.isArray(body.parts) && body.parts.length > 0) {
        await tx.machinePart.createMany({
          data: body.parts.map((p: any) => ({
            machineId: machine.id,
            name: p.name,
            partNumber: p.partNumber ?? null,
            description: p.description ?? null,
            imageUrl: p.imageUrl ?? null,
          })),
        });
      }

      await documentService.registerMachineFormFiles(tx, { machineId: machine.id, firmId: machine.firmId, actorId: ctx.userId, manualUrl: body.userManualUrl, specUrl: body.specificationsSheetUrl, documentUrls: body.documentUrls });
      const finalMachine = await tx.machine.findUnique({ where: { id: machine.id }, include: MACHINE_INCLUDE });
      return machineMapper.toDTO(finalMachine ?? machine);
    });
  },

  async update(id: string, body: Record<string, any>, ctx: UserAuthContext) {
    const existing = await prisma.machine.findUnique({ where: { id } });
    if (!existing || !isVisible(ctx, existing)) throw ApiError.notFound('Machine not found');
    assertWritable(ctx, existing);

    const newFirm = body.firmId !== undefined || body.projectId !== undefined ? ((body.firmId ?? body.projectId ?? null) as bigint | null) : undefined;
    if (newFirm) assertFirmWritable(ctx, newFirm);

    const ownership: 'OWNED' | 'RENTED' = body.ownershipType ?? existing.ownershipType;
    const switching = ownership !== existing.ownershipType;
    const data: Record<string, any> = machineMapper.toPrismaUpdate(body);

    if (ownership === 'RENTED') {
      const sent = RENTED_FORBIDDEN.filter((k) => body[k] !== undefined && body[k] !== null);
      if (sent.length > 0) throw ApiError.badRequest(`Not applicable to a hired machine: ${sent.join(', ')}`);
      if (switching) {
        const registrationNo = body.registrationNo ?? existing.registrationNo;
        const rentalStartAt = body.rentalStartAt ?? existing.rentalStartAt;
        if (!registrationNo) throw ApiError.badRequest('A hired machine needs a registration / identifier');
        if (!rentalStartAt) throw ApiError.badRequest('A hired machine needs a hire start date');
        if (!(newFirm ?? existing.firmId)) throw ApiError.badRequest('A hired machine needs a firm');
        data.hireType = body.hireType ?? existing.hireType ?? 'DRY';
      }
    } else if (switching) {
      // hired -> owned: the hire details no longer apply
      Object.assign(data, { rentalStartAt: null, rentalEndAt: null, rentalVendorId: null, rentalVendorName: null, hireType: null });
    }
    data.ownershipType = ownership;

    if (body.rentalVendorId) {
      const vendor = await prisma.repairVendor.findUnique({ where: { id: body.rentalVendorId }, select: { name: true } });
      if (!vendor) throw ApiError.badRequest('Unknown vendor');
      data.rentalVendorName = body.rentalVendorName ?? vendor.name;
    }

    // Changing the meter basis after readings exist would silently rewrite history.
    const basisChanged =
      (body.readingUnit !== undefined && body.readingUnit !== existing.readingUnit) ||
      (body.openingReading !== undefined && Number(body.openingReading) !== Number(existing.openingReading));
    if (basisChanged) {
      const logged = await prisma.machineUsageLog.count({ where: { machineId: id, voidedAt: null } });
      if (logged > 0) throw ApiError.conflict('Readings already exist for this machine, so its reading unit and opening reading can no longer be changed');
    }
    if (data.readingUnit === 'NONE') data.openingReading = 0;

    const firmForSite = newFirm !== undefined ? newFirm : existing.firmId;
    if (body.siteLocationId !== undefined) {
      if (body.siteLocationId && firmForSite) {
        const site = await prisma.siteLocationDetails.findFirst({
          where: { id: BigInt(body.siteLocationId), firm_id: firmForSite },
          select: { id: true, location: true },
        });
        if (!site) throw ApiError.badRequest('That site does not belong to this firm');
        data.location = body.location ?? site.location;
      } else if (!body.siteLocationId) {
        data.siteLocationId = null;
      }
    }

    const row = await prisma.$transaction(async (tx) => {
      const updated = await tx.machine.update({ where: { id }, data, include: MACHINE_INCLUDE });
      if (updated.assetId) {
        // keep the linked Asset from drifting away from its machine
        await tx.asset.update({
          where: { id: updated.assetId },
          data: {
            productName: updated.name,
            brand: updated.manufacturer,
            model: updated.modelNumber,
            serialNo: updated.registrationNo ?? updated.serialNumber,
            location: updated.location,
            firmId: updated.firmId,
            ownershipType: updated.ownershipType,
            ...(switching && ownership === 'RENTED' ? { maintenanceRequired: false } : {}),
            ...(switching && ownership === 'OWNED' ? { maintenanceRequired: true } : {}),
          },
        });
      }
      return updated;
    });
    return machineMapper.toDTO(row);
  },

  async delete(id: string, ctx: UserAuthContext) {
    const existing = await prisma.machine.findUnique({ where: { id } });
    if (!existing || !isVisible(ctx, existing)) throw ApiError.notFound('Machine not found');
    assertWritable(ctx, existing);
    try {
      await machineRepository.delete(id);
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw ApiError.conflict('This machine has diesel, usage, work order or repair history and cannot be deleted. Mark it decommissioned instead.');
      }
      throw e;
    }
  },

  async assertExists(id: string) {
    const row = await machineRepository.findById(id);
    if (!row) throw ApiError.notFound('Machine not found');
    return row;
  },
};
