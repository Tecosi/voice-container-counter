import type { Container, ParsedLine, SummaryLine } from "./types";

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const payload = isJson ? await res.json() : await res.text();

  if (!res.ok) {
    const msg =
      typeof payload === "object" && payload && "error" in payload
        ? String((payload as any).error)
        : `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return payload as T;
}

export const api = {
  createContainer: (label: string) =>
    http<Container>("/containers", { method: "POST", body: JSON.stringify({ label }) }),

  getContainer: (id: string) => http<Container>(`/containers/${encodeURIComponent(id)}`),

  parse: (text: string) =>
    http<{ lines: ParsedLine[] }>("/parse", { method: "POST", body: JSON.stringify({ text }) }),

  addLine: (containerId: string, itemLabel: string, quantity: number) =>
    http<Container>(`/containers/${encodeURIComponent(containerId)}/lines`, {
      method: "POST",
      body: JSON.stringify({ itemLabel, quantity })
    }),

  updateLine: (containerId: string, lineId: string, patch: { itemLabel?: string; quantity?: number }) =>
    http<Container>(`/containers/${encodeURIComponent(containerId)}/lines/${encodeURIComponent(lineId)}`, {
      method: "PUT",
      body: JSON.stringify(patch)
    }),

  getSummary: (containerId: string) =>
    http<SummaryLine[]>(`/containers/${encodeURIComponent(containerId)}/summary`)
};