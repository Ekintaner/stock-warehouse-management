import assert from "node:assert/strict";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
} from "node:crypto";
import test from "node:test";
import { buildApp } from "../../app.js";
import type { AuthStore, SessionWithUser } from "./auth-store.js";
import type {
  AppRole,
  AuthenticatedUser,
} from "./authorization.js";
import {
  requireAuthenticatedUser,
  requireRole,
  requireWarehouseAccess,
  requireWarehouseMutation,
  AuthorizationError,
} from "./authorization.js";
import {
  hashPassword,
  PasswordHashCapacityError,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "./password.js";
import { LoginRateLimiter } from "./rate-limiter.js";

const PASSWORD = "yerel-guvenli-parola-2026";
const USER: AuthenticatedUser = {
  id: "user-1",
  username: "yonetici",
  displayName: "Yerel Yönetici",
  role: "ADMIN",
  warehouseIds: [],
};

interface MemorySession extends SessionWithUser {
  tokenHash: string;
}

class MemoryAuthStore implements AuthStore {
  readonly sessions = new Map<string, MemorySession>();
  readonly user: AuthenticatedUser & {
    passwordHash: string;
    isActive: boolean;
  };

  constructor(passwordHash: string, role: AppRole = "ADMIN") {
    this.user = {
      ...USER,
      role,
      passwordHash,
      isActive: true,
    };
  }

  async findUserByUsername(username: string) {
    return username === this.user.username ? this.user : null;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date) {
    const session: MemorySession = {
      id: `session-${this.sessions.size + 1}`,
      userId,
      tokenHash,
      expiresAt,
      revokedAt: null,
      user: this.user,
    };
    this.sessions.set(tokenHash, session);
    return { id: session.id };
  }

  async updatePasswordHash(
    _userId: string,
    passwordHash: string,
  ): Promise<void> {
    this.user.passwordHash = passwordHash;
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async updateSessionLastSeen(): Promise<void> {}

  async revokeSession(tokenHash: string, revokedAt: Date): Promise<void> {
    const session = this.sessions.get(tokenHash);
    if (session) {
      session.revokedAt = revokedAt;
    }
  }
}

function tokenFromCookie(cookie: string | undefined): string {
  assert.ok(cookie);
  const match = cookie.match(/stock_session=([A-Za-z0-9_-]{43})/);
  assert.ok(match?.[1]);
  return match[1];
}

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function makeLegacyHash(password: string): Promise<string> {
  const salt = randomBytes(16);
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      64,
      { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
      (error, key) => {
        if (error) {
          reject(error);
        } else {
          resolve(
            `scrypt$32768$8$1$${salt.toString("base64url")}$${key.toString("base64url")}`,
          );
        }
      },
    );
  });
}

test("password hashes use unique salts and verify without storing plaintext", async () => {
  const firstHash = await hashPassword(PASSWORD);
  const secondHash = await hashPassword(PASSWORD);

  assert.notEqual(firstHash, secondHash);
  assert.match(firstHash, /^scrypt\$131072\$8\$1\$/);
  assert.equal(await verifyPassword(PASSWORD, firstHash), true);
  assert.equal(await verifyPassword("yanlis-parola", firstHash), false);
  assert.equal(firstHash.includes(PASSWORD), false);
});

test("scrypt limits active and queued derivations", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 11 }, (_, index) =>
      hashPassword(`${PASSWORD}-${index}`),
    ),
  );

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    10,
  );
  const rejected = results.find((result) => result.status === "rejected");
  assert.ok(rejected && rejected.status === "rejected");
  assert.ok(rejected.reason instanceof PasswordHashCapacityError);
});

test("legacy scrypt hashes verify and upgrade after a successful login", async () => {
  const legacyHash = await makeLegacyHash(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, legacyHash), true);
  assert.equal(passwordHashNeedsUpgrade(legacyHash), true);

  const store = new MemoryAuthStore(legacyHash);
  const app = buildApp({ store });
  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { username: USER.username, password: PASSWORD },
    });
    assert.equal(response.statusCode, 200);
    assert.match(store.user.passwordHash, /^scrypt\$131072\$8\$1\$/);
    assert.equal(await verifyPassword(PASSWORD, store.user.passwordHash), true);
  } finally {
    await app.close();
  }
});

test("login issues an HttpOnly SameSite cookie and a safe user response", async () => {
  const store = new MemoryAuthStore(await hashPassword(PASSWORD));
  const app = buildApp({ store });

  try {
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { username: " YONETICI ", password: PASSWORD },
    });

    assert.equal(response.statusCode, 200);
    const cookieHeader = headerValue(response.headers["set-cookie"]) ?? "";
    assert.match(cookieHeader, /HttpOnly/);
    assert.match(cookieHeader, /SameSite=Strict/);
    assert.match(cookieHeader, /Path=\/api/);
    assert.equal(cookieHeader.includes("Secure"), false);
    assert.equal("passwordHash" in response.json().user, false);
    assert.equal(response.json().user.username, "yonetici");
    assert.match(response.json().csrfToken, /^[A-Za-z0-9_-]{43}$/);
  } finally {
    await app.close();
  }
});

test("session requires the cookie and logout requires CSRF before revocation", async () => {
  const store = new MemoryAuthStore(await hashPassword(PASSWORD));
  const app = buildApp({ store });

  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { username: USER.username, password: PASSWORD },
    });
    const rawCookie = headerValue(login.headers["set-cookie"]);
    const cookie = rawCookie?.split(";")[0];
    const token = tokenFromCookie(rawCookie);
    const csrfToken = login.json().csrfToken as string;

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });
    assert.equal(session.statusCode, 200);
    assert.equal(session.json().user.id, USER.id);
    assert.equal("passwordHash" in session.json().user, false);

    const rejectedLogout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: { origin: "http://127.0.0.1:5173", cookie },
    });
    assert.equal(rejectedLogout.statusCode, 403);
    assert.equal(
      store.sessions.get(
        createHash("sha256").update(token).digest("hex"),
      )?.revokedAt,
      null,
    );

    const logout = await app.inject({
      method: "POST",
      url: "/api/auth/logout",
      headers: {
        origin: "http://127.0.0.1:5173",
        cookie,
        "x-csrf-token": csrfToken,
      },
    });
    assert.equal(logout.statusCode, 204);

    const afterLogout = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie },
    });
    assert.equal(afterLogout.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("unsafe requests reject unexpected or missing origins", async () => {
  const store = new MemoryAuthStore(await hashPassword(PASSWORD));
  const app = buildApp({ store });

  try {
    for (const origin of [undefined, "https://attacker.invalid"]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        ...(origin ? { headers: { origin } } : {}),
        payload: { username: USER.username, password: PASSWORD },
      });
      assert.equal(response.statusCode, 403);
      assert.equal(response.json().error.code, "INVALID_ORIGIN");
    }
  } finally {
    await app.close();
  }
});

test("login failures hide whether the account exists and enforce the limit", async () => {
  const store = new MemoryAuthStore(await hashPassword(PASSWORD));
  const app = buildApp({ store });

  try {
    const incorrectPassword = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { username: USER.username, password: "wrong-password" },
    });
    const unknownUsername = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { username: "olmayan", password: "wrong-password" },
    });
    assert.equal(incorrectPassword.statusCode, 401);
    assert.deepEqual(incorrectPassword.json(), unknownUsername.json());

    for (let count = 0; count < 4; count += 1) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://127.0.0.1:5173" },
        payload: { username: USER.username, password: "wrong-password" },
      });
      assert.equal(response.statusCode, 401);
    }
    const limited = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { username: USER.username, password: "wrong-password" },
    });
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers["retry-after"]);
  } finally {
    await app.close();
  }
});

test("expired sessions are rejected by the server", async () => {
  const store = new MemoryAuthStore(await hashPassword(PASSWORD));
  let currentTime = new Date("2026-10-06T00:00:00.000Z");
  const app = buildApp({ store, now: () => currentTime });

  try {
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin: "http://127.0.0.1:5173" },
      payload: { username: USER.username, password: PASSWORD },
    });
    const cookie = tokenFromCookie(
      headerValue(login.headers["set-cookie"]),
    );
    currentTime = new Date(currentTime.getTime() + 12 * 60 * 60 * 1_000);
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: { cookie: `stock_session=${cookie}` },
    });
    assert.equal(session.statusCode, 401);
  } finally {
    await app.close();
  }
});

test("failed logins are rate limited by account and address", () => {
  let currentTime = 1_000;
  const limiter = new LoginRateLimiter(() => currentTime);

  for (let count = 0; count < 5; count += 1) {
    assert.equal(limiter.check("127.0.0.1", "yonetici").allowed, true);
    limiter.recordFailure("127.0.0.1", "yonetici");
  }
  const blocked = limiter.check("127.0.0.1", "yonetici");
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);

  currentTime += 15 * 60 * 1_000;
  assert.equal(limiter.check("127.0.0.1", "yonetici").allowed, true);
});

test("role and warehouse guards deny unassigned or read-only access", () => {
  const manager: AuthenticatedUser = {
    id: "manager",
    username: "depo",
    displayName: "Depo Sorumlusu",
    role: "WAREHOUSE_MANAGER",
    warehouseIds: ["warehouse-1"],
  };
  const viewer: AuthenticatedUser = { ...manager, role: "VIEWER" };
  const admin: AuthenticatedUser = { ...USER };

  requireWarehouseMutation(manager, "warehouse-1");
  requireWarehouseAccess(admin, "any-warehouse");
  assert.throws(
    () => requireWarehouseAccess(manager, "warehouse-2"),
    (error: unknown) =>
      error instanceof AuthorizationError && error.code === "FORBIDDEN",
  );
  assert.throws(
    () => requireRole(viewer, ["ADMIN", "WAREHOUSE_MANAGER"]),
    (error: unknown) =>
      error instanceof AuthorizationError && error.code === "FORBIDDEN",
  );
  assert.throws(() => requireWarehouseMutation(viewer, "warehouse-1"));
  assert.throws(
    () => requireAuthenticatedUser(null),
    (error: unknown) =>
      error instanceof AuthorizationError &&
      error.code === "UNAUTHENTICATED",
  );
});

test("authorization failures map to the correct HTTP status", async () => {
  const store = new MemoryAuthStore(await hashPassword(PASSWORD));
  const app = buildApp({ store });
  app.get("/test/forbidden", async () => {
    throw new AuthorizationError("FORBIDDEN", "Bu işlem için yetkiniz yok.");
  });
  app.get("/test/unauthenticated", async () => {
    throw new AuthorizationError(
      "UNAUTHENTICATED",
      "Devam etmek için giriş yapın.",
    );
  });

  try {
    const forbidden = await app.inject({
      method: "GET",
      url: "/test/forbidden",
    });
    const unauthenticated = await app.inject({
      method: "GET",
      url: "/test/unauthenticated",
    });
    assert.equal(forbidden.statusCode, 403);
    assert.equal(unauthenticated.statusCode, 401);
  } finally {
    await app.close();
  }
});
