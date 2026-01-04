export type ParsedLine = { itemLabel: string; quantity: number };

export function parseDictationText(text: string): ParsedLine[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];

  const segments = raw
    .split(/[;,]/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const lines: ParsedLine[] = [];

  for (const seg of segments) {
    const match = seg.match(/\d+/); // premier entier trouvé
    if (!match) continue;

    const qty = Number.parseInt(match[0], 10);
    if (!Number.isFinite(qty)) continue;

    const idx = seg.indexOf(match[0]);
    const itemLabel = (seg.slice(0, idx) + seg.slice(idx + match[0].length)).trim();

    if (!itemLabel) continue;

    lines.push({ itemLabel, quantity: qty });
  }

  return lines;
}