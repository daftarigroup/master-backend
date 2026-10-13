import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { config } from '../../../config';
import type { AuthenticatedRequest } from '../../../middleware/auth.middleware';

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

// Who is calling: the user row behind the JWT (null when anonymous).
async function loadCaller(req: Request) {
  const id = (req as AuthenticatedRequest).user?.id;
  if (!id || !/^\d+$/.test(String(id))) return null;
  return prisma.user.findUnique({ where: { id: BigInt(id) } });
}

type Caller = NonNullable<Awaited<ReturnType<typeof loadCaller>>>;

// The Manage Users page can be given to a plain USER (page key manage_users), so the server checks the same things the page does.
function canManageUsers(caller: Caller | null): boolean {
  if (!caller) return false;
  if (caller.role === 'SUPER_ADMIN' || caller.role === 'ADMIN' || caller.administrate) return true;
  const pa: any = caller.page_access;
  const entry = pa && typeof pa === 'object' ? pa.manage_users : undefined;
  return Boolean(entry) && entry !== 'NONE';
}

// Only a SUPER_ADMIN may hand out or touch the SUPER_ADMIN role.
function assertCanTouchRole(caller: Caller, targetRole: string | null | undefined, newRole?: string) {
  if (caller.role === 'SUPER_ADMIN') return;
  if (targetRole === 'SUPER_ADMIN' || newRole === 'SUPER_ADMIN') {
    throw new ApiError(403, 'Only a super admin can create, change or delete a super admin');
  }
}

export class UserController {
  // GET /api/store/users: also the assignee picker of the checklist screens, so any logged-in user may read it, but only a user
  // manager sees passwords (they are plaintext until the hashing stage).
  getUsers = asyncHandler(async (req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      orderBy: { timestamp: 'desc' },
    });
    const showPasswords = canManageUsers(await loadCaller(req));

    res.json({
      success: true,
      data: showPasswords ? users : users.map(({ password: _password, ...rest }) => rest),
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

    // Session restore: the token must already belong to this user (or to a user manager). Before, anyone could mint a token
    // for any username from here.
    const caller = await loadCaller(req);
    if (!caller || (caller.id !== user.id && !canManageUsers(caller))) {
      throw new ApiError(403, 'Forbidden: this session does not belong to that user');
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
    let userData = parseUserPayload(req.body);

    const caller = await loadCaller(req);
    if (!caller) {
      // Public "Create Account": a plain, view-only account with no systems, pages or projects until a user manager grants them.
      userData = {
        user_name: userData.user_name,
        name: userData.name,
        password: userData.password,
        role: 'USER',
        modify_access: 'VIEW',
        system_access: [],
        page_access: {},
        firm_access: [],
      };
    } else {
      if (!canManageUsers(caller)) throw new ApiError(403, 'Forbidden: you cannot manage users');
      assertCanTouchRole(caller, null, userData.role);
    }

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

    const caller = await loadCaller(req);
    if (!canManageUsers(caller)) throw new ApiError(403, 'Forbidden: you cannot manage users');
    const target = await prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!target) throw new ApiError(404, 'User not found');
    assertCanTouchRole(caller!, target.role, userData.role);

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

    const caller = await loadCaller(req);
    if (!canManageUsers(caller)) throw new ApiError(403, 'Forbidden: you cannot manage users');
    const target = await prisma.user.findUnique({ where: { id: BigInt(id) } });
    if (!target) throw new ApiError(404, 'User not found');
    assertCanTouchRole(caller!, target.role);

    await prisma.user.delete({
      where: { id: BigInt(id) },
    });

    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  });
}
