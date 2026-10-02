import type { Product, Row } from "./types.ts";

export function underlyingFromDescription(description: string): string {
  // Match the broker's product description, keeping commas within asset names.
  // Exercise and migration descriptions contain no underlying information.
  const match = /\bauf\s+(.+?)(?:,\s*quantity\s*:.*)?$/i.exec(description.replace(/\s+/g, " ").trim());
  return match?.[1].trim() ?? "";
}

export function productsWithUnderlyings(products: Product[], rows: Row[]): Product[] {
  const inferred = new Map<string, string>();
  for (const row of rows) {
    if (row.asset_class !== "DERIVATIVE" || inferred.has(row.symbol)) continue;
    const underlying = underlyingFromDescription(row.description || "");
    if (underlying) inferred.set(row.symbol, underlying);
  }
  return products.map(product => product.asset_class === "DERIVATIVE"
    ? { ...product, underlying: inferred.get(product.isin) || product.name }
    : product);
}
