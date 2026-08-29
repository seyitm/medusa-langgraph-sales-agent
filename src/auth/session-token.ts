import { timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import type { StoreContext } from "../domain/types.js";
import { AppError } from "../errors.js";

export const storeContextSchema = z.object({
  cartId: z.string().min(1).optional(),
  regionId: z.string().min(1),
  countryCode: z.string().regex(/^[A-Za-z]{2}$/).optional(),
  locale: z.string().min(2).max(35).optional(),
});

const tokenPayloadSchema = z.object({
  sub: z.string().min(1),
  thread_id: z.uuid(),
  store: storeContextSchema,
});

export interface SessionClaims {
  subject: string;
  threadId: string;
  store: StoreContext;
}

export function normalizeStoreContext(context: z.infer<typeof storeContextSchema>): StoreContext {
  return {
    ...(context.cartId ? { cartId: context.cartId } : {}),
    regionId: context.regionId,
    ...(context.countryCode ? { countryCode: context.countryCode.toLowerCase() } : {}),
    ...(context.locale ? { locale: context.locale } : {}),
  };
}

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueSessionToken(
  claims: SessionClaims,
  config: AppConfig["auth"],
): Promise<{ token: string; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + config.tokenTtlSeconds * 1000);
  const token = await new SignJWT({ thread_id: claims.threadId, store: claims.store })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.subject)
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secretKey(config.jwtSecret));
  return { token, expiresAt: expiresAt.toISOString() };
}

export async function verifySessionToken(
  token: string,
  config: AppConfig["auth"],
): Promise<SessionClaims> {
  try {
    const verified = await jwtVerify(token, secretKey(config.jwtSecret), {
      algorithms: ["HS256"],
      issuer: config.issuer,
      audience: config.audience,
    });
    const parsed = tokenPayloadSchema.parse(verified.payload);
    return { subject: parsed.sub, threadId: parsed.thread_id, store: parsed.store };
  } catch (error) {
    throw new AppError("AUTH_FAILED", "The session token is invalid or expired", 401, false, {
      cause: error,
    });
  }
}

export function contextMatches(expected: StoreContext, received: StoreContext): boolean {
  return (
    expected.cartId === received.cartId &&
    expected.regionId === received.regionId &&
    expected.countryCode === received.countryCode &&
    expected.locale === received.locale
  );
}

export function issuerKeyMatches(expected: string, received: string | undefined): boolean {
  if (!received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}
