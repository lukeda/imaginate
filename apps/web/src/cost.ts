import Decimal from "decimal.js";
import type { ImageModelProvider } from "@imaginate/shared";

export type PricingLine = ImageModelProvider["pricing"][number];

export function formatCost(cost: Decimal.Value | null | undefined): string | null {
  if (cost === null || cost === undefined) return null;
  const d = new Decimal(cost);
  if (d.isZero()) return "$0";
  let s: string;
  if (d.gte(1)) s = d.toFixed(2);
  else if (d.gte(0.01)) s = d.toFixed(3);
  else if (d.gte(1e-9)) s = d.toFixed(9);
  else s = d.toExponential(2);
  const cleaned = s.replace(/0+$/, "").replace(/\.$/, "");
  return `$${cleaned}`;
}

/** Human-readable unit suffix for a pricing line. */
export function unitLabel(billable: string, unit: string): string {
  if (unit === "image") return "/image";
  if (unit === "megapixel") return "/MP";
  if (unit === "token") {
    switch (billable) {
      case "output_image":
        return "/output-token";
      case "input_image":
        return "/input-image-token";
      case "input_text":
        return "/input-text-token";
      case "output_text":
        return "/output-text-token";
      default:
        return "/token";
    }
  }
  return `/${billable || unit}`;
}

export function pricingLineLabel(line: PricingLine): string {
  const price = formatCost(line.costUsd) ?? "—";
  const unit = unitLabel(line.billable, line.unit);
  return line.variant ? `${price}${unit} (${line.variant})` : `${price}${unit}`;
}

export interface EstimateBasis {
  tokensPerImage: number;
  megapixels: number;
}

const DEFAULT_BASIS: EstimateBasis = { tokensPerImage: 2000, megapixels: 1 };

const MP_BY_RESOLUTION: Record<string, number> = { "512": 0.25, "1K": 1, "2K": 4, "4K": 16 };

/** Approximate megapixels for a resolution tier; defaults to 1 MP. */
export function resolutionToMegapixels(resolution: string | null | undefined): number {
  if (resolution && MP_BY_RESOLUTION[resolution] !== undefined) return MP_BY_RESOLUTION[resolution];
  return 1;
}

/**
 * Estimated per-image cost for a provider, derived from the `output_image`
 * pricing line. `image` units are used directly, `megapixel` and `token` lines
 * are converted using the supplied basis.
 */
export function estimatePerImageCost(
  pricing: PricingLine[],
  basis: Partial<EstimateBasis> = {},
): number | null {
  if (!pricing || pricing.length === 0) return null;
  const { tokensPerImage, megapixels } = { ...DEFAULT_BASIS, ...basis };

  const convert = (line: PricingLine): Decimal | null => {
    if (typeof line.costUsd !== "number") return null;
    switch (line.unit) {
      case "megapixel":
        return new Decimal(line.costUsd).times(megapixels);
      case "token":
        return new Decimal(line.costUsd).times(tokensPerImage);
      default:
        return new Decimal(line.costUsd);
    }
  };

  const output = pricing.filter((p) => p.billable === "output_image");
  const source = output.length > 0 ? output : pricing;
  const costs = source.map(convert).filter((c): c is Decimal => c !== null);
  if (costs.length === 0) return null;
  return Decimal.min(...costs).toNumber();
}
