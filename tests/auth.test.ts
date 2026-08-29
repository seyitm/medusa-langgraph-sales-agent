import { describe, expect, it } from "vitest";
import {
  contextMatches,
  issueSessionToken,
  issuerKeyMatches,
  verifySessionToken,
} from "../src/auth/session-token.js";

const auth = {
  jwtSecret: "test-secret-that-is-definitely-over-32-characters",
  issuer: "test-issuer",
  audience: "test-audience",
  sessionIssuerKey: "independent-session-issuer-key",
  tokenTtlSeconds: 900,
} as const;

describe("session tokens", () => {
  it("round-trips signed commerce context", async () => {
    const claims = {
      subject: "anonymous-browser-1",
      threadId: "f6696620-f216-4c43-b3f6-7eb67437c3e2",
      store: { cartId: "cart_1", regionId: "reg_1", countryCode: "tr", locale: "en-US" },
    };
    const issued = await issueSessionToken(claims, auth);
    await expect(verifySessionToken(issued.token, auth)).resolves.toEqual(claims);
  });

  it("detects context substitution", () => {
    expect(contextMatches({ cartId: "cart_1", regionId: "reg_1" }, { cartId: "cart_2", regionId: "reg_1" })).toBe(false);
  });

  it("compares issuer keys without accepting different lengths", () => {
    expect(issuerKeyMatches("a-secure-issuer-key", "a-secure-issuer-key")).toBe(true);
    expect(issuerKeyMatches("a-secure-issuer-key", "wrong")).toBe(false);
  });
});
