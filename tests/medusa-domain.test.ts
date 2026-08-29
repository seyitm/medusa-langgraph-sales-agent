import { describe, expect, it } from "vitest";
import { cartFingerprint, findVariant } from "../src/medusa/client.js";
import { emptyCart, product } from "./fixtures.js";

describe("normalized commerce helpers", () => {
  it("produces stable cart fingerprints and detects changes", () => {
    const first = emptyCart();
    const same = structuredClone(first);
    const changed = { ...first, updatedAt: "2026-08-29T10:02:00.000Z" };
    expect(cartFingerprint(first)).toBe(cartFingerprint(same));
    expect(cartFingerprint(first)).not.toBe(cartFingerprint(changed));
  });

  it("resolves a variant only from its parent product", () => {
    expect(findVariant(product, "variant_blue_m")?.title).toBe("Blue / M");
    expect(findVariant(product, "variant_invented")).toBeUndefined();
  });
});
