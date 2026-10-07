import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { closeDatabase, getPrismaClient } from "../../database/prisma.js";
import { createInitialAdmin } from "./initial-admin.js";
import { hashPassword } from "./password.js";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,64}$/;

async function readHidden(prompt: string): Promise<string> {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error("Parola girişi için etkileşimli bir terminal gereklidir.");
  }

  emitKeypressEvents(stdin);
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();

  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (error?: Error) => {
      stdin.off("keypress", onKeypress);
      stdin.setRawMode(false);
      stdout.write("\n");
      if (error) {
        reject(error);
      } else {
        resolve(value);
      }
    };

    const onKeypress = (
      character: string,
      key: { name?: string; ctrl?: boolean },
    ) => {
      if (key.ctrl && key.name === "c") {
        finish(new Error("İşlem iptal edildi."));
      } else if (key.name === "return" || key.name === "enter") {
        finish();
      } else if (key.name === "backspace") {
        value = value.slice(0, -1);
      } else if (character && !key.ctrl && Buffer.byteLength(value) < 1_024) {
        value += character;
      }
    };

    stdin.on("keypress", onKeypress);
  });
}

async function main(): Promise<void> {
  const terminal = createInterface({ input: stdin, output: stdout });
  let password: string;
  let confirmation: string;
  try {
    const username = (await terminal.question("Kullanıcı adı: "))
      .trim()
      .toLowerCase();
    const displayName = (await terminal.question("Görünen ad: ")).trim();

    if (!USERNAME_PATTERN.test(username)) {
      throw new Error(
        "Kullanıcı adı 3-64 karakter olmalı; yalnızca a-z, 0-9, nokta, alt çizgi ve tire kullanın.",
      );
    }
    if (displayName.length === 0 || displayName.length > 120) {
      throw new Error("Görünen ad 1-120 karakter arasında olmalıdır.");
    }

    password = await readHidden("Parola (en az 14 karakter): ");
    confirmation = await readHidden("Parolayı tekrar girin: ");
    if (password.length < 14 || Buffer.byteLength(password, "utf8") > 1_024) {
      throw new Error("Parola en az 14 karakter ve en fazla 1024 bayt olmalıdır.");
    }
    if (password !== confirmation) {
      throw new Error("Girilen parolalar eşleşmiyor.");
    }

    const passwordHash = await hashPassword(password);
    const prisma = getPrismaClient();
    await prisma.$transaction(async (transaction) => {
      await createInitialAdmin(transaction, {
        username,
        displayName,
        passwordHash,
      });
    });

    stdout.write("İlk yönetici hesabı oluşturuldu.\n");
  } finally {
    terminal.close();
    await closeDatabase();
  }
}

void main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.";
  const secrets = [
    process.env.DATABASE_URL,
    process.env.MIGRATION_DATABASE_URL,
  ].filter((secret): secret is string => Boolean(secret));
  let safeMessage = message;
  for (const secret of secrets) {
    safeMessage = safeMessage.replaceAll(secret, "[gizli bağlantı bilgisi]");
  }
  console.error(`Yönetici hesabı oluşturulamadı: ${safeMessage}`);
  process.exitCode = 1;
});
