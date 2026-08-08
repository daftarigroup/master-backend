import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { config } from '../../../config';

function parseUserPayload(body: any) {
  const payload: any = {};

  if (body.user_name !== undefined || body.username !== undefined) {
    payload.user_name = String(body.user_name || body.username || '').trim();
  }

  if (body.name !== undefined) {
    payload.name = String(body.name || '').trim();
  }

  if (body.password !== undefined) {
    payload.password = String(body.password || '').trim();
  }

  if (body.role !== undefined) {
    const r = String(body.role || '').toUpperCase();
    if (r === 'SUPER_ADMIN' || r === 'ADMIN' || r === 'USER') {
      payload.role = r;
    }
  }

  if (body.modify_access !== undefined) {
    const ma = String(body.modify_access || '').toUpperCase();
    payload.modify_access = ma === 'VIEW' ? 'VIEW' : 'EDIT';
  } else if (payload.role) {
    payload.modify_access = (payload.role === 'SUPER_ADMIN' || payload.role === 'ADMIN') ? 'EDIT' : 'VIEW';
  }

  if (body.day_off !== undefined) {
    payload.day_off = String(body.day_off || '').trim();
  }

  if (body.system_access !== undefined) {
    payload.system_access = body.system_access;
  }

  if (body.page_access !== undefined) {
    payload.page_access = body.page_access;
  }

  if (body.firm_access !== undefined && Array.isArray(body.firm_access)) {
    payload.firm_access = body.firm_access
      .map((item: any) => {
        try {
          const num = Number(item);
          return !isNaN(num) ? BigInt(num) : null;
        } catch {
          return null;
        }
      })
      .filter((v: any): v is bigint => v !== null);
  }

  const booleanPermissionKeys = [
    'administrate',
    'store_issue',
    'issue_data',
    'inventory',
    'create_indent',
    'create_po',
    'indent_approval_view',
    'indent_approval_action',
    'update_vendor_view',
    'update_vendor_action',
    'three_party_approval_view',
    'three_party_approval_action',
    'receive_item_view',
    'receive_item_action',
    'store_out_approval_view',
    'store_out_approval_action',
    'pending_indents_view',
    'orders_view',
    'again_auditing',
    'take_entry_by_telly',
    'reaudit_data',
    'rectify_the_mistake',
    'audit_data',
    'send_debit_note',
    'return_material_to_party',
    'exchange_materials',
    'instead_of_quality_check_in_received_item',
    'db_for_pc',
    'bill_not_received',
    'store_in',
    'po_history',
    'full_kiting',
    'make_payment',
    'pending_po',
    'hod_store_approval',
    'store_issue_return',
  ];

  booleanPermissionKeys.forEach((key) => {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    const val = body[key] !== undefined ? body[key] : body[camelKey];
    if (val !== undefined) {
      payload[key] = val === true || val === 'true' || val === 'TRUE';
    }
  });

  return payload;
}

export class UserController {
  // GET /api/store/users
  getUsers = asyncHandler(async (req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      orderBy: { timestamp: 'desc' },
    });

    res.json({
      success: true,
      data: users,
    });
  });

  // POST /api/store/users/authenticate
  authenticate = asyncHandler(async (req: Request, res: Response) => {
    const rawUsername = String(req.body.username || '').trim();
    const rawPassword = String(req.body.password || '').trim();

    if (!rawUsername || !rawPassword) {
      throw new ApiError(400, 'Username and password are required');
    }

    const user = await prisma.user.findFirst({
      where: {
        user_name: { equals: rawUsername, mode: 'insensitive' },
        password: rawPassword,
      },
    });

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid username or password',
        data: null,
      });
    }

    const checklistToken = jwt.sign(
      {
        id: String(user.id),
        role: user.role || 'USER',
        permittedFirms: (user.firm_access || []).map(String),
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );

    res.json({
      success: true,
      data: user,
      checklistToken,
    });
  });

  // GET /api/store/users/by-username/:username
  getByUsername = asyncHandler(async (req: Request, res: Response) => {
    const username = req.params.username as string;

    const user = await prisma.user.findFirst({
      where: { user_name: username },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
        data: null,
      });
    }

    const checklistToken = jwt.sign(
      {
        id: String(user.id),
        role: user.role || 'USER',
        permittedFirms: (user.firm_access || []).map(String),
      },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn as any }
    );

    res.json({
      success: true,
      data: user,
      checklistToken,
    });
  });

  // POST /api/store/users
  createUser = asyncHandler(async (req: Request, res: Response) => {
    const userData = parseUserPayload(req.body);

    if (!userData.modify_access) {
      userData.modify_access = 'EDIT';
    }

    const newUser = await prisma.user.create({
      data: userData,
    });

    res.status(201).json({
      success: true,
      data: newUser,
    });
  });

  // PATCH /api/store/users/:id
  updateUser = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;
    const userData = parseUserPayload(req.body);

    const updated = await prisma.user.update({
      where: { id: BigInt(id) },
      data: userData,
    });

    res.json({
      success: true,
      data: updated,
    });
  });

  // DELETE /api/store/users/:id
  deleteUser = asyncHandler(async (req: Request, res: Response) => {
    const id = req.params.id as string;

    await prisma.user.delete({
      where: { id: BigInt(id) },
    });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  });
}
