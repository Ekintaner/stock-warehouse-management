import { registerOperationsRoutes } from "./modules/operations/operations-routes.js";
import Fastify, { type FastifyInstance } from "fastify";
import { closeDatabase } from "./database/prisma.js";
import { AuthorizationError } from "./modules/auth/authorization.js";
import {
  registerAuthRoutes,
  resolveSecureCookieSetting,
} from "./modules/auth/auth-routes.js";
import type { AuthRouteOptions } from "./modules/auth/auth-routes.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { ApiError } from "./shared/api-error.js";
import { registerCatalogRoutes } from "./modules/catalog/catalog-routes.js";
import { registerStockRoutes } from "./modules/inventory/stock-routes.js";
import { registerTransferRoutes } from "./modules/inventory/transfer-routes.js";
import { registerCountRoutes } from "./modules/inventory/count-routes.js";

export function buildApp(
  authOptions: AuthRouteOptions = {},
  catalogPrisma?: PrismaClient,
): FastifyInstance {
  const app = Fastify({
    logger: {
      redact: {
        paths: [
          "req.headers.cookie",
          "req.headers.authorization",
          'req.headers["x-csrf-token"]',
          "password",
          "passwordHash",
          "token",
        ],
        censor: "[REDACTED]",
      },
    },
  });

  app.decorateRequest("authenticatedUser", null);
  registerAuthRoutes(app, {
    ...authOptions,
    secureCookies:
      authOptions.secureCookies ??
      resolveSecureCookieSetting(process.env.COOKIE_SECURE),
  });
  registerCatalogRoutes(app, catalogPrisma);
  registerStockRoutes(app, catalogPrisma);
  registerTransferRoutes(app, catalogPrisma);
  registerCountRoutes(app, catalogPrisma);
  registerOperationsRoutes(app, catalogPrisma);

  app.addHook("onClose", async () => {
    await closeDatabase();
  });

  app.get("/api/health", async () => ({ status: "ok" }));

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "İstenen kaynak bulunamadı.",
      },
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details !== undefined ? { details: error.details } : {}),
        },
      });
    }

    if (error instanceof AuthorizationError) {
      const statusCode = error.code === "UNAUTHENTICATED" ? 401 : 403;
      return reply.code(statusCode).send({
        error: { code: error.code, message: error.message },
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      Array.isArray(error.validation)
    ) {
      return reply.code(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "İstek bilgileri geçersiz.",
        },
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "statusCode" in error &&
      typeof error.statusCode === "number" &&
      error.statusCode >= 400 &&
      error.statusCode < 500
    ) {
      return reply.code(error.statusCode).send({
        error: {
          code: "INVALID_REQUEST",
          message: "İstek bilgileri geçersiz veya desteklenmiyor.",
        },
      });
    }

    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "P2002"
    ) {
      return reply
        .code(409)
        .send({
          error: {
            code: "CONFLICT",
            message: "Bu kod veya kullanıcı adı zaten kullanılıyor.",
          },
        });
    }
    request.log.error({ err: error }, "İstek işlenirken beklenmeyen hata");
    return reply.code(500).send({
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "Beklenmeyen bir sunucu hatası oluştu.",
      },
    });
  });

  return app;
}
