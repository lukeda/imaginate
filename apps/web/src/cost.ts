export function formatCost(cost: number | null | undefined): string | null {
  if (cost === null || cost === undefined) return null;
  const s = cost < 0.0001 ? cost.toExponential(1) : cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3);
  const cleaned = s.replace(/0+$/, "").replace(/\.$/, "");
  return `$${cleaned}`;
}