import type { Cart, Product, StoreContext } from "../src/domain/types.js";

export const storeContext: StoreContext = {
  cartId: "cart_test",
  regionId: "reg_test",
  countryCode: "tr",
  locale: "en-US",
};

export const product: Product = {
  id: "prod_shirt",
  handle: "linen-shirt",
  title: "Linen Shirt",
  description: "A lightweight shirt.",
  categories: ["Shirts"],
  variants: [
    {
      id: "variant_blue_m",
      title: "Blue / M",
      options: [
        { optionId: "color", optionTitle: "Color", value: "Blue" },
        { optionId: "size", optionTitle: "Size", value: "M" },
      ],
      price: { amount: 100, currencyCode: "TRY" },
      inventoryStatus: "in_stock",
      inventoryQuantity: 10,
    },
  ],
};

export function emptyCart(): Cart {
  return {
    id: "cart_test",
    regionId: "reg_test",
    currencyCode: "TRY",
    updatedAt: "2026-08-29T10:00:00.000Z",
    items: [],
    subtotal: { amount: 0, currencyCode: "TRY" },
    total: { amount: 0, currencyCode: "TRY" },
  };
}
