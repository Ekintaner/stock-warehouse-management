import { UserRole } from "../../generated/prisma/enums.js";
import type { Prisma } from "../../generated/prisma/client.js";

const INITIAL_ADMIN_LOCK_KEY = 2_026_100_603_001;

export interface InitialAdminInput {
  username: string;
  displayName: string;
  passwordHash: string;
}

export class InitialAdminAlreadyExistsError extends Error {
  constructor() {
    super("Yönetici hesabı zaten var; mevcut kullanıcılar değiştirilmedi.");
    this.name = "InitialAdminAlreadyExistsError";
  }
}

export async function createInitialAdmin(
  transaction: Prisma.TransactionClient,
  input: InitialAdminInput,
): Promise<{ id: string }> {
  await transaction.$executeRaw`
    SELECT pg_advisory_xact_lock(${INITIAL_ADMIN_LOCK_KEY}::bigint)
  `;

  const existingAdmin = await transaction.user.findFirst({
    where: { role: UserRole.ADMIN },
    select: { id: true },
  });
  if (existingAdmin) {
    throw new InitialAdminAlreadyExistsError();
  }

  return transaction.user.create({
    data: {
      username: input.username,
      displayName: input.displayName,
      passwordHash: input.passwordHash,
      role: UserRole.ADMIN,
    },
    select: { id: true },
  });
}
