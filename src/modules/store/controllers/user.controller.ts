import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../../../database/prisma';
import { asyncHandler } from '../../../utils/asyncHandler';
import { ApiError } from '../../../utils/ApiError';
import { config } from '../../../config';

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

    // Token scoped to the Checklist & Delegation module only (see auth.middleware.ts);
    // the rest of the app has no backend auth enforcement and does not use this.
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

    res.json({
      success: true,
      data: user,
    });
  });

  // POST /api/store/users
  createUser = asyncHandler(async (req: Request, res: Response) => {
    const userData = req.body;

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
    const userData = req.body;

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
