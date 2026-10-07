import assert from "node:assert/strict";
import test from "node:test";
import { buildApp } from "./app.js";

test("health endpoint reports that the API process is running", async () => {
  const app = buildApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { status: "ok" });
  } finally {
    await app.close();
  }
});

test("unknown routes return a consistent not-found response", async () => {
  const app = buildApp();

  try {
    const response = await app.inject({
      method: "GET",
      url: "/api/unknown",
    });

    assert.equal(response.statusCode, 404);
    assert.deepEqual(response.json(), {
      error: {
        code: "NOT_FOUND",
        message: "İstenen kaynak bulunamadı.",
      },
    });
  } finally {
    await app.close();
  }
});
