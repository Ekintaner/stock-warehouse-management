import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AuthStore, SessionWithUser } from "./auth-store.js";
import { PrismaAuthStore } from "./auth-store.js";
import type { AuthenticatedUser } from "./authorization.js";
import { LoginRateLimiter } from "./rate-limiter.js";
import {
  hashPassword,
  PasswordHashCapacityError,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "./password.js";

declare module "fastify" {
  interface FastifyRequest {
    authenticatedUser: AuthenticatedUser | null;
  }
}

const COOKIE_NAME = "stock_session";
const SESSION_LIFETIME_MS = 12 * 60 * 60 * 1_000;
const INVALID_CREDENTIALS = {
  error: {
    code: "INVALID_CREDENTIALS",
    message: "Kullanıcı adı veya parola hatalı.",
  },
};

interface LoginBody {
  username: string;
  password: string;
}

export interface AuthRouteOptions {
  store?: AuthStore;
  appOrigin?: string;
  secureCookies?: boolean;
  now?: () => Date;
  limiter?: LoginRateLimiter;
}

interface SessionContext {
  session: SessionWithUser;
  rawToken: string;
}

const dummyPasswordHash = hashPassword(
  "not-a-real-user-password-for-timing-equalization",
);

export function resolveAppOrigin(value: string | undefined): string {
  const origin = value ?? "http://127.0.0.1:5173";
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error("APP_ORIGIN geçerli bir yerel web adresi olmalıdır.");
  }
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    origin !== parsed.origin ||
    !["http:", "https:"].includes(parsed.protocol) ||
    !["127.0.0.1", "localhost", "::1"].includes(hostname)
  ) {
    throw new Error(
      "APP_ORIGIN yalnızca yerel web arayüzünün tam origin adresi olabilir.",
    );
  }
  return origin;
}

export function resolveSecureCookieSetting(value: string | undefined): boolean {
  if (value === undefined || value === "false") {
    return false;
  }
  if (value === "true") {
    return true;
  }
  throw new Error("COOKIE_SECURE yalnızca true veya false olabilir.");
}

function parseCookie(request: FastifyRequest): string | null {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    return null;
  }

  const match = cookieHeader.match(
    /(?:^|;\s*)stock_session=([A-Za-z0-9_-]{43})(?:;|$)/,
  );
  return match?.[1] ?? null;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function csrfTokenFor(token: string, sessionId: string): string {
  return createHmac("sha256", token)
    .update(`stock-warehouse-csrf:v1:${sessionId}`)
    .digest("base64url");
}

function matchesCsrf(supplied: string | undefined, expected: string): boolean {
  if (!supplied || !/^[A-Za-z0-9_-]{43}$/.test(supplied)) {
    return false;
  }
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

function toPublicUser(user: AuthenticatedUser): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    warehouseIds: user.warehouseIds,
  };
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  secureCookies: boolean,
): void {
  const secure = secureCookies ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${COOKIE_NAME}=${token}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=${SESSION_LIFETIME_MS / 1_000}${secure}`,
  );
}

function clearSessionCookie(reply: FastifyReply, secureCookies: boolean): void {
  const secure = secureCookies ? "; Secure" : "";
  reply.header(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

function errorReply(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
) {
  return reply.code(statusCode).send({ error: { code, message } });
}

function isUnsafeMethod(method: string): boolean {
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

export function registerAuthRoutes(
  app: FastifyInstance,
  options: AuthRouteOptions = {},
): void {
  const store = options.store ?? new PrismaAuthStore();
  const limiter = options.limiter ?? new LoginRateLimiter();
  const now = options.now ?? (() => new Date());
  const appOrigin = resolveAppOrigin(
    options.appOrigin ?? process.env.APP_ORIGIN,
  );
  const secureCookies = options.secureCookies ?? false;

  app.addHook("onRequest", async (request, reply) => {
    const path = request.url.split("?")[0] ?? "";
    const isCatalogRequest =
      path.startsWith("/api/products") ||
      path.startsWith("/api/categories") ||
      path.startsWith("/api/warehouses");
    const isStockRequest =
      path === "/api/stock" ||
      path.startsWith("/api/suppliers") ||
      path.startsWith("/api/stock-documents") ||
      path.startsWith("/api/stock-movements") ||
      path.startsWith("/api/transfers") ||
      path === "/api/transfer-warehouses" ||
      path.startsWith("/api/counts");
    const unsafe = isUnsafeMethod(request.method);

    if (unsafe && request.headers.origin !== appOrigin) {
      return errorReply(
        reply,
        403,
        "INVALID_ORIGIN",
        "İstek kaynağı doğrulanamadı.",
      );
    }

    if (unsafe && path === "/api/auth/login") {
      return;
    }
    if (
      !unsafe &&
      !isCatalogRequest &&
      !isStockRequest &&
      !path.startsWith("/api/")
    ) {
      return;
    }

    const context = await readSession(request);
    request.authenticatedUser = context
      ? toPublicUser(context.session.user)
      : null;
    if (unsafe && context && !verifyCsrf(request, context)) {
      return errorReply(
        reply,
        403,
        "CSRF_INVALID",
        "İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.",
      );
    }
  });

  async function readSession(
    request: FastifyRequest,
  ): Promise<SessionContext | null> {
    const rawToken = parseCookie(request);
    if (!rawToken) {
      return null;
    }

    const session = await store.findSessionByTokenHash(hashToken(rawToken));
    const currentTime = now();
    if (
      !session ||
      session.revokedAt !== null ||
      session.expiresAt.getTime() <= currentTime.getTime() ||
      !session.user.isActive
    ) {
      return null;
    }

    return { session, rawToken };
  }

  function verifyCsrf(
    request: FastifyRequest,
    context: SessionContext,
  ): boolean {
    const supplied = request.headers["x-csrf-token"];
    const csrfHeader = Array.isArray(supplied) ? supplied[0] : supplied;
    return matchesCsrf(
      csrfHeader,
      csrfTokenFor(context.rawToken, context.session.id),
    );
  }

  app.get("/api/auth/session", async (request, reply) => {
    const context = await readSession(request);
    if (!context) {
      clearSessionCookie(reply, secureCookies);
      return errorReply(
        reply,
        401,
        "UNAUTHENTICATED",
        "Devam etmek için giriş yapın.",
      );
    }

    await store.updateSessionLastSeen(context.session.id, now());
    return {
      user: toPublicUser(context.session.user),
      csrfToken: csrfTokenFor(context.rawToken, context.session.id),
    };
  });

  app.post<{ Body: LoginBody }>(
    "/api/auth/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "password"],
          properties: {
            username: { type: "string", minLength: 1, maxLength: 64 },
            password: { type: "string", minLength: 1, maxLength: 1_024 },
          },
        },
      },
    },
    async (request, reply) => {
      const username = request.body.username.trim().toLowerCase();
      const address = request.ip;
      const limit = limiter.check(address, username);
      if (!limit.allowed) {
        reply.header("Retry-After", String(limit.retryAfterSeconds));
        return errorReply(
          reply,
          429,
          "LOGIN_RATE_LIMITED",
          "Çok fazla başarısız giriş denemesi. Bir süre sonra tekrar deneyin.",
        );
      }

      const user = await store.findUserByUsername(username);
      const passwordHash = user?.passwordHash ?? (await dummyPasswordHash);
      let passwordMatches: boolean;
      try {
        passwordMatches = await verifyPassword(
          request.body.password,
          passwordHash,
        );
      } catch (error) {
        if (error instanceof PasswordHashCapacityError) {
          reply.header("Retry-After", "2");
          return errorReply(
            reply,
            503,
            "AUTH_CAPACITY",
            "Giriş işlemi şu anda yoğun. Biraz sonra tekrar deneyin.",
          );
        }
        throw error;
      }
      if (!user || !user.isActive || !passwordMatches) {
        limiter.recordFailure(address, username);
        return reply.code(401).send(INVALID_CREDENTIALS);
      }

      limiter.clear(address, username);
      if (passwordHashNeedsUpgrade(user.passwordHash)) {
        try {
          const upgradedHash = await hashPassword(request.body.password);
          await store.updatePasswordHash(user.id, upgradedHash);
        } catch (error) {
          if (error instanceof PasswordHashCapacityError) {
            reply.header("Retry-After", "2");
            return errorReply(
              reply,
              503,
              "AUTH_CAPACITY",
              "Giriş işlemi şu anda yoğun. Biraz sonra tekrar deneyin.",
            );
          }
          throw error;
        }
      }
      const rawToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(now().getTime() + SESSION_LIFETIME_MS);
      const session = await store.createSession(
        user.id,
        hashToken(rawToken),
        expiresAt,
      );
      setSessionCookie(reply, rawToken, secureCookies);

      return {
        user: toPublicUser(user),
        csrfToken: csrfTokenFor(rawToken, session.id),
      };
    },
  );

  app.post("/api/auth/logout", async (request, reply) => {
    const context = await readSession(request);
    if (!context) {
      clearSessionCookie(reply, secureCookies);
      return errorReply(
        reply,
        401,
        "UNAUTHENTICATED",
        "Oturum sona ermiş. Yeniden giriş yapın.",
      );
    }
    if (!verifyCsrf(request, context)) {
      return errorReply(
        reply,
        403,
        "CSRF_INVALID",
        "İstek doğrulanamadı. Sayfayı yenileyip tekrar deneyin.",
      );
    }

    await store.revokeSession(hashToken(context.rawToken), now());
    clearSessionCookie(reply, secureCookies);
    return reply.code(204).send();
  });
}
