import { buildApp } from "./app.js";

const DEFAULT_PORT = 3000;

function readPort(value: string | undefined): number {
  if (value === undefined) {
    return DEFAULT_PORT;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error("PORT pozitif bir tam sayı olmalıdır.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT 1 ile 65535 arasında olmalıdır.");
  }

  return port;
}

async function startServer(): Promise<void> {
  const app = buildApp();
  let stopping = false;

  async function stop(signal: NodeJS.Signals): Promise<void> {
    if (stopping) {
      return;
    }
    stopping = true;

    app.log.info({ signal }, "Sunucu kontrollü olarak kapatılıyor");
    try {
      await app.close();
    } catch (error) {
      app.log.error({ err: error }, "Sunucu kapatılırken hata oluştu");
      process.exitCode = 1;
    }
  }

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));

  try {
    const port = readPort(process.env.PORT);
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    app.log.error({ err: error }, "Sunucu başlatılamadı");
    process.exitCode = 1;
    await app.close();
  }
}

void startServer();
