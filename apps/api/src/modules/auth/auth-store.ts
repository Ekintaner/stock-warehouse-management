import type { PrismaClient } from "../../generated/prisma/client.js";
import type { UserRole } from "../../generated/prisma/enums.js";
import { getPrismaClient } from "../../database/prisma.js";
import type {
  AppRole,
  AuthenticatedUser,
} from "./authorization.js";

export interface SessionWithUser {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt: Date | null;
  user: AuthenticatedUser & { isActive: boolean };
}

export interface AuthStore {
  findUserByUsername(
    username: string,
  ): Promise<(AuthenticatedUser & { passwordHash: string; isActive: boolean }) | null>;
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
  createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<{ id: string }>;
  findSessionByTokenHash(tokenHash: string): Promise<SessionWithUser | null>;
  updateSessionLastSeen(sessionId: string, lastSeenAt: Date): Promise<void>;
  revokeSession(tokenHash: string, revokedAt: Date): Promise<void>;
}

function toRole(role: UserRole): AppRole {
  return role;
}

function toUser(
  record: {
    id: string;
    username: string;
    displayName: string;
    role: UserRole;
    isActive: boolean;
    warehouseAssignments: { warehouseId: string }[];
  },
): AuthenticatedUser & { isActive: boolean } {
  return {
    id: record.id,
    username: record.username,
    displayName: record.displayName,
    role: toRole(record.role),
    isActive: record.isActive,
    warehouseIds: record.warehouseAssignments.map(
      (assignment) => assignment.warehouseId,
    ),
  };
}

export class PrismaAuthStore implements AuthStore {
  private readonly prisma: PrismaClient | undefined;

  constructor(prisma?: PrismaClient) {
    this.prisma = prisma;
  }

  private get client(): PrismaClient {
    return this.prisma ?? getPrismaClient();
  }

  async findUserByUsername(
    username: string,
  ): Promise<
    (AuthenticatedUser & { passwordHash: string; isActive: boolean }) | null
  > {
    const user = await this.client.user.findUnique({
      where: { username },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        passwordHash: true,
        isActive: true,
        warehouseAssignments: {
          select: { warehouseId: true },
        },
      },
    });
    return user ? { ...toUser(user), passwordHash: user.passwordHash } : null;
  }

  async createSession(
    userId: string,
    tokenHash: string,
    expiresAt: Date,
  ): Promise<{ id: string }> {
    return this.client.session.create({
      data: { userId, tokenHash, expiresAt },
      select: { id: true },
    });
  }

  async updatePasswordHash(
    userId: string,
    passwordHash: string,
  ): Promise<void> {
    await this.client.user.update({
      where: { id: userId },
      data: { passwordHash },
    });
  }

  async findSessionByTokenHash(
    tokenHash: string,
  ): Promise<SessionWithUser | null> {
    const session = await this.client.session.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        userId: true,
        expiresAt: true,
        revokedAt: true,
        user: {
          select: {
            id: true,
            username: true,
            displayName: true,
            role: true,
            isActive: true,
            warehouseAssignments: {
              select: { warehouseId: true },
            },
          },
        },
      },
    });
    if (!session) {
      return null;
    }
    return {
      id: session.id,
      userId: session.userId,
      expiresAt: session.expiresAt,
      revokedAt: session.revokedAt,
      user: toUser(session.user),
    };
  }

  async updateSessionLastSeen(
    sessionId: string,
    lastSeenAt: Date,
  ): Promise<void> {
    await this.client.session.update({
      where: { id: sessionId },
      data: { lastSeenAt },
    });
  }

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    await this.client.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt },
    });
  }
}
