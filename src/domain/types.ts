export interface StoreContext {
  cartId?: string | undefined;
  regionId: string;
  countryCode?: string | undefined;
  locale?: string | undefined;
}

export interface Money {
  amount: number;
  currencyCode: string;
}

export type InventoryStatus = "in_stock" | "out_of_stock" | "not_managed" | "unknown";

export interface ProductOptionValue {
  optionId: string;
  optionTitle: string;
  value: string;
}

export interface ProductVariant {
  id: string;
  title: string;
  sku?: string;
  options: ProductOptionValue[];
  price?: Money;
  inventoryStatus: InventoryStatus;
  inventoryQuantity?: number;
}

export interface Product {
  id: string;
  handle: string;
  title: string;
  description?: string;
  thumbnail?: string;
  collection?: string;
  categories: string[];
  variants: ProductVariant[];
}

export interface CatalogGroup {
  id: string;
  name: string;
  handle?: string;
}

export interface CartLineItem {
  id: string;
  productId?: string;
  variantId: string;
  title: string;
  variantTitle?: string;
  quantity: number;
  unitPrice: Money;
  total: Money;
}

export interface Cart {
  id: string;
  regionId: string;
  currencyCode: string;
  updatedAt: string;
  items: CartLineItem[];
  subtotal: Money;
  total: Money;
}

export type CartMutation =
  | { kind: "add_item"; variantId: string; quantity: number }
  | { kind: "set_item_quantity"; lineItemId: string; quantity: number }
  | { kind: "remove_item"; lineItemId: string };

export interface PreparedCartMutation {
  actionId: string;
  toolCallId: string;
  toolName: string;
  kind: CartMutation["kind"];
  cartId: string;
  cartFingerprint: string;
  lineItemId?: string;
  productId: string;
  variantId: string;
  productTitle: string;
  variantTitle: string;
  previousQuantity: number;
  desiredQuantity: number;
  unitPrice: Money;
  estimatedTotal: Money;
  expiresAt: string;
}

export interface ToolRuntimeContext {
  store: StoreContext;
  subject: string;
  threadId: string;
}
