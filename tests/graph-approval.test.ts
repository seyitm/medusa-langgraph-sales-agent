import { AIMessage, HumanMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { Command, MemorySaver } from "@langchain/langgraph";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSalesGraph } from "../src/agent/graph.js";
import type { Cart } from "../src/domain/types.js";
import type { MedusaCommerce } from "../src/medusa/client.js";
import { emptyCart, product, storeContext } from "./fixtures.js";

function createCommerce() {
  let cart = emptyCart();
  const commerce: MedusaCommerce = {
    searchProducts: vi.fn(async () => ({ products: [product], count: 1, limit: 8, offset: 0 })),
    getProduct: vi.fn(async () => product),
    listCategories: vi.fn(async () => []),
    listCollections: vi.fn(async () => []),
    getCart: vi.fn(async () => structuredClone(cart)),
    addLineItem: vi.fn(async (_cartId, variantId, quantity) => {
      cart = {
        ...cart,
        updatedAt: "2026-08-29T10:01:00.000Z",
        items: [
          {
            id: "item_1",
            productId: product.id,
            variantId,
            title: product.title,
            variantTitle: product.variants[0]!.title,
            quantity,
            unitPrice: { amount: 100, currencyCode: "TRY" },
            total: { amount: 100 * quantity, currencyCode: "TRY" },
          },
        ],
        subtotal: { amount: 100 * quantity, currencyCode: "TRY" },
        total: { amount: 100 * quantity, currencyCode: "TRY" },
      };
      return structuredClone(cart);
    }),
    setLineItemQuantity: vi.fn(async () => structuredClone(cart)),
    removeLineItem: vi.fn(async () => structuredClone(cart)),
  };
  return commerce;
}

function createLedger() {
  const records = new Map<string, { result?: Cart; status: "executing" | "completed" | "failed" }>();
  return {
    beginExecution: vi.fn(async (actionId: string, threadId: string, desiredQuantity: number) => {
      const existing = records.get(actionId);
      if (existing) {
        return {
          inserted: false,
          record: {
            actionId,
            threadId,
            desiredQuantity,
            status: existing.status,
            ...(existing.result ? { result: existing.result } : {}),
          },
        };
      }
      records.set(actionId, { status: "executing" });
      return {
        inserted: true,
        record: { actionId, threadId, desiredQuantity, status: "executing" as const },
      };
    }),
    completeExecution: vi.fn(async (actionId: string, cart: Cart) => {
      records.set(actionId, { status: "completed", result: cart });
    }),
    failExecution: vi.fn(async (actionId: string) => {
      records.set(actionId, { status: "failed" });
    }),
  };
}

const input = {
  messages: [new HumanMessage("Add the medium blue linen shirt")],
  runtime: { store: storeContext, subject: "shopper-1", threadId: "thread-1" },
};

describe("cart approval graph", () => {
  let commerce: ReturnType<typeof createCommerce>;
  let ledger: ReturnType<typeof createLedger>;

  beforeEach(() => {
    commerce = createCommerce();
    ledger = createLedger();
  });

  it("does not mutate the cart before approval and rejection stays read-only", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "add_cart_item",
          args: { productId: product.id, variantId: product.variants[0]!.id, quantity: 1 },
          id: "tool_add_1",
        },
      ])
      .respond(new AIMessage("Okay, I left your cart unchanged."));
    const graph = createSalesGraph({
      model,
      commerce,
      database: ledger,
      checkpointer: new MemorySaver(),
      approvalTtlSeconds: 600,
    });
    const config = { configurable: { thread_id: "thread-reject" } };

    await graph.invoke(input, config);
    expect(commerce.addLineItem).not.toHaveBeenCalled();
    expect((await graph.getState(config)).tasks[0]?.interrupts).toHaveLength(1);

    const result = await graph.invoke(new Command({ resume: "reject" }), config);
    expect(commerce.addLineItem).not.toHaveBeenCalled();
    expect((result.messages.at(-1) as AIMessage).content).toContain("unchanged");
  });

  it("executes one absolute cart change after approval", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "add_cart_item",
          args: { productId: product.id, variantId: product.variants[0]!.id, quantity: 1 },
          id: "tool_add_2",
        },
      ])
      .respond(new AIMessage("The shirt is now in your cart."));
    const graph = createSalesGraph({
      model,
      commerce,
      database: ledger,
      checkpointer: new MemorySaver(),
      approvalTtlSeconds: 600,
    });
    const config = { configurable: { thread_id: "thread-approve" } };

    await graph.invoke(input, config);
    const result = await graph.invoke(new Command({ resume: "approve" }), config);

    expect(commerce.addLineItem).toHaveBeenCalledOnce();
    expect(commerce.addLineItem).toHaveBeenCalledWith("cart_test", "variant_blue_m", 1);
    expect(ledger.completeExecution).toHaveBeenCalledOnce();
    expect(result.lastCart?.items[0]?.quantity).toBe(1);
  });

  it("refuses an approval when the cart changed after the proposal", async () => {
    const model = fakeModel()
      .respondWithTools([
        {
          name: "add_cart_item",
          args: { productId: product.id, variantId: product.variants[0]!.id, quantity: 1 },
          id: "tool_add_stale",
        },
      ])
      .respond(new AIMessage("Your cart changed, so I did not apply the old proposal."));
    const graph = createSalesGraph({
      model,
      commerce,
      database: ledger,
      checkpointer: new MemorySaver(),
      approvalTtlSeconds: 600,
    });
    const config = { configurable: { thread_id: "thread-stale" } };

    await graph.invoke(input, config);
    vi.mocked(commerce.getCart).mockResolvedValue({
      ...emptyCart(),
      updatedAt: "2026-08-29T10:05:00.000Z",
    });
    const result = await graph.invoke(new Command({ resume: "approve" }), config);

    expect(commerce.addLineItem).not.toHaveBeenCalled();
    expect(ledger.failExecution).toHaveBeenCalledOnce();
    expect((result.messages.at(-1) as AIMessage).content).toContain("did not apply");
  });
});
