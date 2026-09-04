import { Clock, Effect } from "effect";

export const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 365;

const VERSION = "v1";
const NONCE_BYTES = 32;
const NONCE_LENGTH = 43;
const SIGNATURE_LENGTH = 43;
const encoder = new TextEncoder();

export interface SessionConfig {
  readonly pin: string;
  /** Exactly 32 bytes, encoded as 64 hexadecimal characters. */
  readonly secret: string;
}

export const isValidSessionSecret = (secret: string): boolean => /^[0-9a-fA-F]{64}$/.test(secret);

const bytesFromHex = (hex: string): Uint8Array => {
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index++)
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
};

const base64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

const signingInput = (prefix: string, pin: string): Uint8Array =>
  encoder.encode(`${prefix}\0${pin}`);

const importKey = (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    bytesFromHex(secret).buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );

/** Create a versioned, stateless token. The PIN is bound by the signature but is never serialized. */
export const createSessionToken = (config: SessionConfig): Effect.Effect<string, Error> =>
  Effect.gen(function* () {
    if (!isValidSessionSecret(config.secret))
      return yield* Effect.fail(new Error("Invalid session secret"));
    const now = yield* Clock.currentTimeMillis;
    const expiresAt = Math.floor(now / 1_000) + SESSION_DURATION_SECONDS;
    const nonceBytes = new Uint8Array(NONCE_BYTES);
    crypto.getRandomValues(nonceBytes);
    const prefix = `${VERSION}.${expiresAt}.${base64Url(nonceBytes)}`;
    const key = yield* Effect.tryPromise(() => importKey(config.secret));
    const signature = yield* Effect.tryPromise(() =>
      crypto.subtle.sign("HMAC", key, signingInput(prefix, config.pin).buffer as ArrayBuffer),
    );
    return `${prefix}.${base64Url(new Uint8Array(signature))}`;
  });

const decodeBase64Url = (value: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    const padded =
      value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
    return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
  } catch {
    return undefined;
  }
};

/** Verify syntax, lifetime, and signature. Invalid input is an ordinary false result. */
export const verifySessionToken = (
  token: string | undefined,
  config: SessionConfig,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (!token || token.length > 128 || !isValidSessionSecret(config.secret)) return false;
    const parts = token.split(".");
    if (parts.length !== 4 || parts[0] !== VERSION) return false;
    const expiryText = parts[1];
    const nonce = parts[2];
    const signatureText = parts[3];
    if (expiryText === undefined || nonce === undefined || signatureText === undefined)
      return false;
    if (
      !/^[1-9][0-9]{0,10}$/.test(expiryText) ||
      nonce.length !== NONCE_LENGTH ||
      signatureText.length !== SIGNATURE_LENGTH
    )
      return false;
    const expiresAt = Number(expiryText);
    if (!Number.isSafeInteger(expiresAt)) return false;
    const now = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
    if (expiresAt <= now || expiresAt > now + SESSION_DURATION_SECONDS) return false;
    const nonceBytes = decodeBase64Url(nonce);
    const signature = decodeBase64Url(signatureText);
    if (nonceBytes?.length !== NONCE_BYTES || signature?.length !== 32) return false;
    const prefix = `${VERSION}.${expiryText}.${nonce}`;
    return yield* Effect.tryPromise({
      try: async () => {
        const key = await importKey(config.secret);
        return crypto.subtle.verify(
          "HMAC",
          key,
          signature.buffer as ArrayBuffer,
          signingInput(prefix, config.pin).buffer as ArrayBuffer,
        );
      },
      catch: () => false,
    }).pipe(Effect.catch(() => Effect.succeed(false)));
  });
