import { createHash } from "node:crypto";
import MedusaDefault, { type Config as MedusaConfig, type Store } from "@medusajs/js-sdk";
import type { CatalogGroup, Cart, Money, Product, ProductVariant, StoreContext } from "../domain/types.js";
import { AppError } from "../errors.js";

type UnknownRecord = Record<string, unknown>;

export interface ProductSearchInput {
  query?: string;
  categoryIds?: string[];
  collectionIds?: string[];
  limit?: number;
  offset?: number;
}

export interface ProductSearchResult {
  products: Product[];
  count: number;
  limit: number;
  offset: number;
}

export interface MedusaCommerce {
  searchProducts(input: ProductSearchInput, context: StoreContext): Promise<ProductSearchResult>;
  getProduct(productId: string, context: StoreContext): Promise<Product>;
  listCategories(): Promise<CatalogGroup[]>;
  listCollections(): Promise<CatalogGroup[]>;
  getCart(cartId: string): Promise<Cart>;
  addLineItem(cartId: string, variantId: string, quantity: number): Promise<Cart>;
  setLineItemQuantity(cartId: string, lineItemId: string, quantity: number): Promise<Cart>;
  removeLineItem(cartId: string, lineItemId: string): Promise<Cart>;
}

function record(value: unknown): UnknownRecord {
  return value && typeof value === "object" ? (value as UnknownRecord) : {};
}

function records(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requiredText(value: unknown, label: string): string {
  const parsed = text(value);
  if (!parsed) throw new AppError("MEDUSA_UNAVAILABLE", `Medusa omitted ${label}`, 502, true);
  return parsed;
}

function money(amount: unknown, currencyCode: unknown): Money {
  return {
    amount: number(amount) ?? 0,
    currencyCode: text(currencyCode)?.toUpperCase() ?? "UNKNOWN",
  };
}

function normalizeVariant(raw: UnknownRecord): ProductVariant {
  const calculatedPrice = record(raw.calculated_price);
  const managed = raw.manage_inventory;
  const quantity = number(raw.inventory_quantity);
  const options = records(raw.options).map((option) => {
    const optionDefinition = record(option.option);
    return {
      optionId: requiredText(option.option_id ?? optionDefinition.id, "variant option ID"),
      optionTitle: text(optionDefinition.title) ?? "Option",
      value: requiredText(option.value, "variant option value"),
    };
  });

  let inventoryStatus: ProductVariant["inventoryStatus"] = "unknown";
  if (managed === false) inventoryStatus = "not_managed";
  else if (quantity !== undefined) inventoryStatus = quantity > 0 ? "in_stock" : "out_of_stock";

  const calculatedAmount = number(calculatedPrice.calculated_amount);
  const normalized: ProductVariant = {
    id: requiredText(raw.id, "variant ID"),
    title: text(raw.title) ?? "Default variant",
    options,
    inventoryStatus,
  };
  const sku = text(raw.sku);
  if (sku) normalized.sku = sku;
  if (calculatedAmount !== undefined) {
    normalized.price = money(calculatedAmount, calculatedPrice.currency_code);
  }
  if (quantity !== undefined) normalized.inventoryQuantity = quantity;
  return normalized;
}

function normalizeProduct(raw: UnknownRecord): Product {
  const collection = record(raw.collection);
  const normalized: Product = {
    id: requiredText(raw.id, "product ID"),
    handle: requiredText(raw.handle, "product handle"),
    title: requiredText(raw.title, "product title"),
    categories: records(raw.categories)
      .map((category) => text(category.name) ?? text(category.handle))
      .filter((value): value is string => Boolean(value)),
    variants: records(raw.variants).map(normalizeVariant),
  };
  const description = text(raw.description);
  const thumbnail = text(raw.thumbnail);
  const collectionName = text(collection.title);
  if (description) normalized.description = description;
  if (thumbnail) normalized.thumbnail = thumbnail;
  if (collectionName) normalized.collection = collectionName;
  return normalized;
}

function normalizeCart(raw: UnknownRecord): Cart {
  const currencyCode = requiredText(raw.currency_code, "cart currency code").toUpperCase();
  const normalizedItems = records(raw.items).map((item) => {
    const productId = text(item.product_id);
    const variantTitle = text(item.variant_title);
    return {
      id: requiredText(item.id, "line item ID"),
      ...(productId ? { productId } : {}),
      variantId: requiredText(item.variant_id, "line item variant ID"),
      title: text(item.product_title) ?? text(item.title) ?? "Product",
      ...(variantTitle ? { variantTitle } : {}),
      quantity: number(item.quantity) ?? 0,
      unitPrice: money(item.unit_price, currencyCode),
      total: money(item.total, currencyCode),
    };
  });
  return {
    id: requiredText(raw.id, "cart ID"),
    regionId: requiredText(raw.region_id, "cart region ID"),
    currencyCode,
    updatedAt: requiredText(raw.updated_at, "cart updated_at"),
    items: normalizedItems,
    subtotal: money(raw.subtotal, currencyCode),
    total: money(raw.total, currencyCode),
  };
}

async function retryRead<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (const delay of [0, 100, 300]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      return await operation();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export class MedusaClient implements MedusaCommerce {
  private readonly sdk: { store: Store };

  constructor(config: { backendUrl: string; publishableKey: string }) {
    const Medusa = MedusaDefault as unknown as new (sdkConfig: MedusaConfig) => { store: Store };
    this.sdk = new Medusa({
      baseUrl: config.backendUrl,
      publishableKey: config.publishableKey,
      debug: false,
    });
  }

  async searchProducts(input: ProductSearchInput, context: StoreContext): Promise<ProductSearchResult> {
    const limit = Math.min(Math.max(input.limit ?? 8, 1), 12);
    const offset = Math.max(input.offset ?? 0, 0);
    try {
      const response = await retryRead(() =>
        this.sdk.store.product.list({
          ...(input.query ? { q: input.query } : {}),
          ...(input.categoryIds?.length ? { category_id: input.categoryIds } : {}),
          ...(input.collectionIds?.length ? { collection_id: input.collectionIds } : {}),
          region_id: context.regionId,
          ...(context.countryCode ? { country_code: context.countryCode } : {}),
          ...(context.locale ? { locale: context.locale } : {}),
          fields:
            "*variants.calculated_price,+variants.inventory_quantity,+variants.manage_inventory,*variants.options,*variants.options.option,*categories,*collection",
          limit,
          offset,
        }),
      );
      const raw = record(response);
      return {
        products: records(raw.products).map(normalizeProduct),
        count: number(raw.count) ?? records(raw.products).length,
        limit,
        offset,
      };
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not search the Medusa catalog", 502, true, {
        cause: error,
      });
    }
  }

  async getProduct(productId: string, context: StoreContext): Promise<Product> {
    try {
      const response = await retryRead(() =>
        this.sdk.store.product.retrieve(productId, {
          region_id: context.regionId,
          ...(context.countryCode ? { country_code: context.countryCode } : {}),
          ...(context.locale ? { locale: context.locale } : {}),
          fields:
            "*variants.calculated_price,+variants.inventory_quantity,+variants.manage_inventory,*variants.options,*variants.options.option,*categories,*collection",
        }),
      );
      return normalizeProduct(record(record(response).product));
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not retrieve the Medusa product", 502, true, {
        cause: error,
      });
    }
  }

  async listCategories(): Promise<CatalogGroup[]> {
    try {
      const response = await retryRead(() => this.sdk.store.category.list({ limit: 100 }));
      return records(record(response).product_categories).map((category) => ({
        id: requiredText(category.id, "category ID"),
        name: requiredText(category.name, "category name"),
        ...(text(category.handle) ? { handle: requiredText(category.handle, "category handle") } : {}),
      }));
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not list Medusa categories", 502, true, {
        cause: error,
      });
    }
  }

  async listCollections(): Promise<CatalogGroup[]> {
    try {
      const response = await retryRead(() => this.sdk.store.collection.list({ limit: 100 }));
      return records(record(response).collections).map((collection) => ({
        id: requiredText(collection.id, "collection ID"),
        name: requiredText(collection.title, "collection title"),
        ...(text(collection.handle) ? { handle: requiredText(collection.handle, "collection handle") } : {}),
      }));
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not list Medusa collections", 502, true, {
        cause: error,
      });
    }
  }

  async getCart(cartId: string): Promise<Cart> {
    try {
      const response = await retryRead(() => this.sdk.store.cart.retrieve(cartId));
      return normalizeCart(record(record(response).cart));
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not retrieve the Medusa cart", 502, true, {
        cause: error,
      });
    }
  }

  async addLineItem(cartId: string, variantId: string, quantity: number): Promise<Cart> {
    try {
      const response = await this.sdk.store.cart.createLineItem(cartId, {
        variant_id: variantId,
        quantity,
      });
      return normalizeCart(record(record(response).cart));
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not add the item to the Medusa cart", 502, true, {
        cause: error,
      });
    }
  }

  async setLineItemQuantity(cartId: string, lineItemId: string, quantity: number): Promise<Cart> {
    try {
      const response = await this.sdk.store.cart.updateLineItem(cartId, lineItemId, { quantity });
      return normalizeCart(record(record(response).cart));
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not update the Medusa cart item", 502, true, {
        cause: error,
      });
    }
  }

  async removeLineItem(cartId: string, lineItemId: string): Promise<Cart> {
    try {
      const response = await this.sdk.store.cart.deleteLineItem(cartId, lineItemId);
      return normalizeCart(record(record(response).parent));
    } catch (error) {
      throw new AppError("MEDUSA_UNAVAILABLE", "Could not remove the Medusa cart item", 502, true, {
        cause: error,
      });
    }
  }
}

export function cartFingerprint(cart: Cart): string {
  const stable = {
    id: cart.id,
    updatedAt: cart.updatedAt,
    items: [...cart.items]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(({ id, variantId, quantity, unitPrice }) => ({ id, variantId, quantity, unitPrice })),
    total: cart.total,
  };
  return createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

export function findVariant(product: Product, variantId: string): ProductVariant | undefined {
  return product.variants.find((variant) => variant.id === variantId);
}
