import { tool, type StructuredToolInterface, type ToolRunnableConfig } from "@langchain/core/tools";
import { z } from "zod";
import type { ToolRuntimeContext } from "../domain/types.js";
import { AppError } from "../errors.js";
import type { MedusaCommerce } from "../medusa/client.js";

function runtimeContext(config?: ToolRunnableConfig): ToolRuntimeContext {
  const runtime = config?.configurable?.runtimeContext as ToolRuntimeContext | undefined;
  if (!runtime) throw new AppError("INVALID_REQUEST", "Tool runtime context is missing", 500);
  return runtime;
}

export function createAgentTools(commerce: MedusaCommerce) {
  const searchProducts = tool(
    async (input, config) => {
      const runtime = runtimeContext(config);
      const result = await commerce.searchProducts(
        {
          ...(input.query ? { query: input.query } : {}),
          ...(input.categoryIds ? { categoryIds: input.categoryIds } : {}),
          ...(input.collectionIds ? { collectionIds: input.collectionIds } : {}),
          limit: input.limit,
          offset: input.offset,
        },
        runtime.store,
      );
      return JSON.stringify({ type: "products", ...result });
    },
    {
      name: "search_products",
      description:
        "Search the live Medusa catalog. Use before making product claims or recommendations. Results include variants, current regional prices, and inventory.",
      schema: z.object({
        query: z.string().trim().min(1).optional(),
        categoryIds: z.array(z.string()).max(5).optional(),
        collectionIds: z.array(z.string()).max(5).optional(),
        limit: z.number().int().min(1).max(12).default(8),
        offset: z.number().int().min(0).default(0),
      }),
    },
  );

  const getProduct = tool(
    async ({ productId }, config) => {
      const runtime = runtimeContext(config);
      const product = await commerce.getProduct(productId, runtime.store);
      return JSON.stringify({ type: "product", product });
    },
    {
      name: "get_product",
      description: "Retrieve one live Medusa product by its product ID before discussing exact variants.",
      schema: z.object({ productId: z.string().min(1) }),
    },
  );

  const compareProducts = tool(
    async ({ productIds }, config) => {
      const runtime = runtimeContext(config);
      const products = await Promise.all(
        productIds.map((productId) => commerce.getProduct(productId, runtime.store)),
      );
      return JSON.stringify({ type: "comparison", products });
    },
    {
      name: "compare_products",
      description:
        "Retrieve two to four exact live products for a grounded comparison of variants, prices, and availability.",
      schema: z.object({ productIds: z.array(z.string().min(1)).min(2).max(4) }),
    },
  );

  const listCategories = tool(
    async () => JSON.stringify({ type: "categories", items: await commerce.listCategories() }),
    {
      name: "list_categories",
      description: "List product categories and their IDs before filtering by category.",
      schema: z.object({}),
    },
  );

  const listCollections = tool(
    async () => JSON.stringify({ type: "collections", items: await commerce.listCollections() }),
    {
      name: "list_collections",
      description: "List product collections and their IDs before filtering by collection.",
      schema: z.object({}),
    },
  );

  const getCart = tool(
    async (_input, config) => {
      const runtime = runtimeContext(config);
      if (!runtime.store.cartId) throw new AppError("CART_REQUIRED", "A cart is required", 409);
      const cart = await commerce.getCart(runtime.store.cartId);
      return JSON.stringify({ type: "cart", cart });
    },
    {
      name: "get_cart",
      description: "Retrieve the shopper's current cart. The cart identity comes from verified context.",
      schema: z.object({}),
    },
  );

  const addCartItem = tool(
    async () => "This cart action must be prepared and approved by the graph.",
    {
      name: "add_cart_item",
      description:
        "Propose adding a specific live product variant to the cart. Only call after identifying one exact variant and quantity. This always requires shopper approval.",
      schema: z.object({
        productId: z.string().min(1),
        variantId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    },
  );

  const setCartItemQuantity = tool(
    async () => "This cart action must be prepared and approved by the graph.",
    {
      name: "set_cart_item_quantity",
      description:
        "Propose setting an existing cart line item's absolute quantity. This always requires shopper approval.",
      schema: z.object({
        lineItemId: z.string().min(1),
        quantity: z.number().int().min(1).max(99),
      }),
    },
  );

  const removeCartItem = tool(
    async () => "This cart action must be prepared and approved by the graph.",
    {
      name: "remove_cart_item",
      description: "Propose removing an existing cart line item. This always requires shopper approval.",
      schema: z.object({ lineItemId: z.string().min(1) }),
    },
  );

  const readTools = [
    searchProducts,
    getProduct,
    compareProducts,
    listCategories,
    listCollections,
    getCart,
  ] as StructuredToolInterface[];
  const writeTools = [addCartItem, setCartItemQuantity, removeCartItem] as StructuredToolInterface[];
  return {
    all: [...readTools, ...writeTools],
    readByName: new Map(readTools.map((entry) => [entry.name, entry])),
    writeNames: new Set(writeTools.map((entry) => entry.name)),
  };
}
