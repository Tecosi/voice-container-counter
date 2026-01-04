import { nanoid } from "nanoid";
import type { Container, ContainerLine, SummaryLine } from "./types.js";

const containers = new Map<string, Container>();

export function createContainer(label: string): Container {
  const id = nanoid(10);
  const c: Container = { id, label, lines: [] };
  containers.set(id, c);
  return c;
}

export function getContainer(id: string): Container | undefined {
  return containers.get(id);
}

export function addLine(containerId: string, itemLabel: string, quantity: number): Container | undefined {
  const c = containers.get(containerId);
  if (!c) return undefined;

  const line: ContainerLine = {
    id: nanoid(10),
    itemLabel,
    quantity
  };

  c.lines.push(line);
  return c;
}

export function updateLine(
  containerId: string,
  lineId: string,
  patch: { itemLabel?: string; quantity?: number }
): Container | undefined {
  const c = containers.get(containerId);
  if (!c) return undefined;

  const line = c.lines.find((l) => l.id === lineId);
  if (!line) return undefined;

  if (typeof patch.itemLabel === "string") line.itemLabel = patch.itemLabel;
  if (typeof patch.quantity === "number") line.quantity = patch.quantity;

  return c;
}

export function getSummary(containerId: string): SummaryLine[] | undefined {
  const c = containers.get(containerId);
  if (!c) return undefined;

  const agg = new Map<string, number>();
  for (const l of c.lines) {
    const key = l.itemLabel;
    agg.set(key, (agg.get(key) ?? 0) + l.quantity);
  }

  return Array.from(agg.entries())
    .map(([itemLabel, totalQuantity]) => ({ itemLabel, totalQuantity }))
    .sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));
}