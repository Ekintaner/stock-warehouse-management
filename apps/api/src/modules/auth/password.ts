import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";

const SCRYPT_COST = 131_072;
const LEGACY_SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const MAX_PASSWORD_BYTES = 1_024;
const MAX_ACTIVE_DERIVATIONS = 2;
const MAX_QUEUED_DERIVATIONS = 8;
const MIB = 1024 * 1024;

export class PasswordHashCapacityError extends Error {
  constructor() {
    super("Parola doğrulama kapasitesi dolu.");
    this.name = "PasswordHashCapacityError";
  }
}

interface ScryptParameters {
  cost: number;
  blockSize: number;
  parallelization: number;
}

const CURRENT_PARAMETERS: ScryptParameters = {
  cost: SCRYPT_COST,
  blockSize: SCRYPT_BLOCK_SIZE,
  parallelization: SCRYPT_PARALLELIZATION,
};
const SUPPORTED_PARAMETERS: readonly ScryptParameters[] = [
  CURRENT_PARAMETERS,
  {
    cost: LEGACY_SCRYPT_COST,
    blockSize: SCRYPT_BLOCK_SIZE,
    parallelization: SCRYPT_PARALLELIZATION,
  },
];

let activeDerivations = 0;
const derivationQueue: Array<(release: () => void) => void> = [];

function releaseFactory(): () => void {
  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    const next = derivationQueue.shift();
    if (next) {
      next(releaseFactory());
    } else {
      activeDerivations -= 1;
    }
  };
}

function acquireDerivationSlot(): Promise<() => void> {
  if (activeDerivations < MAX_ACTIVE_DERIVATIONS) {
    activeDerivations += 1;
    return Promise.resolve(releaseFactory());
  }
  if (derivationQueue.length >= MAX_QUEUED_DERIVATIONS) {
    return Promise.reject(new PasswordHashCapacityError());
  }
  return new Promise((resolve) => derivationQueue.push(resolve));
}

function deriveKey(
  password: Buffer,
  salt: Buffer,
  parameters: ScryptParameters,
): Promise<Buffer> {
  return (async () => {
    const release = await acquireDerivationSlot();
    try {
      const maxmem = Math.max(
        64 * MIB,
        Math.ceil(128 * parameters.cost * parameters.blockSize * 1.5),
      );
      return await new Promise<Buffer>((resolve, reject) => {
        scryptCallback(
          password,
          salt,
          KEY_LENGTH,
          {
            N: parameters.cost,
            r: parameters.blockSize,
            p: parameters.parallelization,
            maxmem,
          },
          (error, derivedKey) => {
            if (error) {
              reject(error);
            } else {
              resolve(derivedKey);
            }
          },
        );
      });
    } finally {
      release();
    }
  })();
}

function readParameters(encodedHash: string): ScryptParameters {
  const [algorithm, costValue, blockSizeValue, parallelizationValue] =
    encodedHash.split("$");
  const cost = Number(costValue);
  const blockSize = Number(blockSizeValue);
  const parallelization = Number(parallelizationValue);
  const supported = SUPPORTED_PARAMETERS.find(
    (parameters) =>
      parameters.cost === cost &&
      parameters.blockSize === blockSize &&
      parameters.parallelization === parallelization,
  );
  if (algorithm !== "scrypt" || !supported) {
    throw new Error("Kayıtlı parola özeti desteklenen biçimde değil.");
  }
  return supported;
}

export function passwordHashNeedsUpgrade(encodedHash: string): boolean {
  return readParameters(encodedHash).cost < SCRYPT_COST;
}

function encodeHash(
  salt: Buffer,
  derivedKey: Buffer,
  parameters: ScryptParameters,
): string {
  return [
    "scrypt",
    parameters.cost,
    parameters.blockSize,
    parameters.parallelization,
    salt.toString("base64url"),
    derivedKey.toString("base64url"),
  ].join("$");
}

export async function hashPassword(password: string): Promise<string> {
  const passwordBytes = Buffer.from(password, "utf8");
  if (passwordBytes.length === 0 || passwordBytes.length > MAX_PASSWORD_BYTES) {
    throw new Error("Parola boş olamaz ve en fazla 1024 bayt olmalıdır.");
  }
  const salt = randomBytes(16);
  const derivedKey = await deriveKey(passwordBytes, salt, CURRENT_PARAMETERS);
  return encodeHash(salt, derivedKey, CURRENT_PARAMETERS);
}

export async function verifyPassword(
  password: string,
  encodedHash: string,
): Promise<boolean> {
  const parts = encodedHash.split("$");
  const parameters = readParameters(encodedHash);
  const encodedSalt = parts[4];
  const encodedKey = parts[5];
  if (
    parts.length !== 6 ||
    encodedSalt === undefined ||
    encodedKey === undefined
  ) {
    throw new Error("Kayıtlı parola özeti desteklenen biçimde değil.");
  }

  const passwordBytes = Buffer.from(password, "utf8");
  if (passwordBytes.length === 0 || passwordBytes.length > MAX_PASSWORD_BYTES) {
    return false;
  }

  const salt = Buffer.from(encodedSalt, "base64url");
  const expectedKey = Buffer.from(encodedKey, "base64url");
  if (salt.length !== 16 || expectedKey.length !== KEY_LENGTH) {
    throw new Error("Kayıtlı parola özeti geçersiz.");
  }

  const actualKey = await deriveKey(passwordBytes, salt, parameters);

  return timingSafeEqual(actualKey, expectedKey);
}
