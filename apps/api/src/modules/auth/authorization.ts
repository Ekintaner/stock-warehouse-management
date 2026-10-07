export type AppRole = "ADMIN" | "WAREHOUSE_MANAGER" | "VIEWER";

export interface AuthenticatedUser {
  id: string;
  username: string;
  displayName: string;
  role: AppRole;
  warehouseIds: string[];
}

export class AuthorizationError extends Error {
  constructor(
    public readonly code: "UNAUTHENTICATED" | "FORBIDDEN",
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function requireAuthenticatedUser(
  user: AuthenticatedUser | null,
): AuthenticatedUser {
  if (!user) {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Devam etmek için giriş yapın.",
    );
  }
  return user;
}

export function requireRole(
  user: AuthenticatedUser,
  allowedRoles: readonly AppRole[],
): void {
  if (!allowedRoles.includes(user.role)) {
    throw new AuthorizationError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
  }
}

export function requireWarehouseAccess(
  user: AuthenticatedUser,
  warehouseId: string,
): void {
  if (user.role !== "ADMIN" && !user.warehouseIds.includes(warehouseId)) {
    throw new AuthorizationError(
      "FORBIDDEN",
      "Bu depoya erişim yetkiniz yok.",
    );
  }
}

export function requireWarehouseMutation(
  user: AuthenticatedUser,
  warehouseId: string,
): void {
  requireRole(user, ["ADMIN", "WAREHOUSE_MANAGER"]);
  requireWarehouseAccess(user, warehouseId);
}
