import express from "express";
import cors from "cors";

type ContainerLine = {
  id: string;
  itemLabel: string;
  quantity: number;
};

type Container = {
  id: string;
  label: string;
  lines: ContainerLine[];
};

const app = express();
app.use(express.json());
app.use(cors());

// ---- In-memory store
const containers = new Map<string, Container>();

function uid(len = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ---- Parsing helpers
const FR_NUM: Record<string, number> = {
  "zero": 0, "zéro": 0,
  "un": 1, "une": 1,
  "deux": 2,
  "trois": 3,
  "quatre": 4,
  "cinq": 5,
  "six": 6,
  "sept": 7,
  "huit": 8,
  "neuf": 9,
  "dix": 10,
  "onze": 11,
  "douze": 12,
  "treize": 13,
  "quatorze": 14,
  "quinze": 15,
  "seize": 16,
  "vingt": 20,
};

function normalizeDictation(raw: string): string {
  let t = (raw || "").trim();

  // Normaliser les séparateurs dictés
  t = t.replace(/\bpoint[\s-]?virgule\b/gi, ";");
  t = t.replace(/\bvirgule\b/gi, ",");
  // "et 3 ..." -> séparateur (seulement si un nombre suit)
  t = t.replace(/\bet\s+(?=(\d+|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt)\b)/gi, ", ");

  // Certains moteurs transcrivent des opérateurs en texte/symboles
  // On les traite comme séparateurs (ça évite les "plus + 2 - 4")
  t = t.replace(/\s*[+−-]\s*/g, ", ");

  // Normaliser multiplication
  // "fois 20" -> "x 20"
  t = t.replace(/\bfois\b/gi, "x");

  // Recoller les références type M 6 x 20 -> M6x20
  t = t.replace(/\bm\s*(\d+)\s*[x×]\s*(\d+)\b/gi, (_m, a, b) => `M${a}x${b}`);
  // Recoller M 6 -> M6
  t = t.replace(/\bm\s*(\d+)\b/gi, (_m, a) => `M${a}`);

  // Nettoyage espaces
  t = t.replace(/\s+/g, " ").trim();

  return t;
}

function parseLeadingNumberWord(seg: string): { qty?: number; rest: string } {
  const s = seg.trim();
  const m = s.match(/^([A-Za-zÀ-ÿ-]+)\b/);
  if (!m) return { rest: s };
  const w = m[1].toLowerCase();
  const qty = FR_NUM[w];
  if (qty === undefined) return { rest: s };
  const rest = s.slice(m[0].length).trim();
  return { qty, rest };
}

function extractQuantityAndLabel(segment: string): { quantity: number; itemLabel: string } | null {
  let s = segment.trim();
  if (!s) return null;

  // 1) Quantité en début : "10 vis M6x20"
  let m = s.match(/^(\d+)\s+(.+)$/);
  if (m) {
    const quantity = parseInt(m[1], 10);
    const itemLabel = m[2].trim();
    if (quantity > 0 && itemLabel) return { quantity, itemLabel };
  }

  // 2) Quantité en début en toutes lettres : "dix vis M6x20"
  const leadWord = parseLeadingNumberWord(s);
  if (leadWord.qty !== undefined && leadWord.qty > 0 && leadWord.rest) {
    return { quantity: leadWord.qty, itemLabel: leadWord.rest.trim() };
  }

  // 3) Pattern "vis M6x20 x 10" ou "vis M6x20 x10"
  m = s.match(/^(.*?)(?:\s+)?x\s*(\d+)\s*$/i);
  if (m) {
    const quantity = parseInt(m[2], 10);
    const itemLabel = (m[1] || "").trim();
    if (quantity > 0 && itemLabel) return { quantity, itemLabel };
  }

  // 4) Quantité en fin : "vis M6x20 10"
  m = s.match(/^(.+?)\s+(\d+)\s*$/);
  if (m) {
    const quantity = parseInt(m[2], 10);
    const itemLabel = m[1].trim();
    if (quantity > 0 && itemLabel) return { quantity, itemLabel };
  }

  // 5) Fallback : chercher un nombre "isolé" (pas collé à une lettre)
  // (évite de prendre les chiffres de M6x20)
  const tokens = s.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (/^\d+$/.test(tok)) {
      // Exclure dimensions "6 mm"
      const next = (tokens[i + 1] || "").toLowerCase();
      if (next === "mm" || next === "millimetre" || next === "millimètre" || next === "millimetres" || next === "millimètres") {
        continue;
      }
      const quantity = parseInt(tok, 10);
      if (quantity <= 0) continue;
      tokens.splice(i, 1);
      const itemLabel = tokens.join(" ").trim();
      if (itemLabel) return { quantity, itemLabel };
    }
  }

  return null;
}

function parseDictation(text: string): Array<{ itemLabel: string; quantity: number }> {
  const norm = normalizeDictation(text);
  const segments = norm.split(/[;,]+/g).map(s => s.trim()).filter(Boolean);

  const lines: Array<{ itemLabel: string; quantity: number }> = [];
  for (const seg of segments) {
    const parsed = extractQuantityAndLabel(seg);
    if (!parsed) continue;

    // Normaliser un peu l'affichage
    let label = parsed.itemLabel.replace(/\s+/g, " ").trim();
    // Remettre M6x20 en format "M6x20" (déjà fait), et garder le reste tel quel
    lines.push({ itemLabel: label, quantity: parsed.quantity });
  }

  return lines;
}

// ---- API
app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/parse", (req, res) => {
  const text = String(req.body?.text ?? "");
  if (!text.trim()) return res.status(400).json({ error: "text is required" });
  return res.json({ lines: parseDictation(text) });
});

app.post("/containers", (req, res) => {
  const label = String(req.body?.label ?? "").trim();
  if (!label) return res.status(400).json({ error: "label is required" });
  const id = uid(10);
  const c: Container = { id, label, lines: [] };
  containers.set(id, c);
  res.status(201).json(c);
});

app.get("/containers/:id", (req, res) => {
  const c = containers.get(req.params.id);
  if (!c) return res.status(404).json({ error: "container not found" });
  res.json(c);
});

app.post("/containers/:id/lines", (req, res) => {
  const c = containers.get(req.params.id);
  if (!c) return res.status(404).json({ error: "container not found" });

  const itemLabel = String(req.body?.itemLabel ?? "").trim();
  const quantity = Number(req.body?.quantity);

  if (!itemLabel) return res.status(400).json({ error: "itemLabel is required" });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: "quantity must be a positive number" });

  c.lines.push({ id: uid(10), itemLabel, quantity });
  res.json(c);
});

app.put("/containers/:id/lines/:lineId", (req, res) => {
  const c = containers.get(req.params.id);
  if (!c) return res.status(404).json({ error: "container not found" });

  const line = c.lines.find(l => l.id === req.params.lineId);
  if (!line) return res.status(404).json({ error: "line not found" });

  if (req.body?.itemLabel !== undefined) {
    const v = String(req.body.itemLabel).trim();
    if (!v) return res.status(400).json({ error: "itemLabel cannot be empty" });
    line.itemLabel = v;
  }
  if (req.body?.quantity !== undefined) {
    const q = Number(req.body.quantity);
    if (!Number.isFinite(q) || q <= 0) return res.status(400).json({ error: "quantity must be a positive number" });
    line.quantity = q;
  }

  res.json(c);
});

app.get("/containers/:id/summary", (req, res) => {
  const c = containers.get(req.params.id);
  if (!c) return res.status(404).json({ error: "container not found" });

  const totals = new Map<string, number>();
  for (const l of c.lines) {
    totals.set(l.itemLabel, (totals.get(l.itemLabel) ?? 0) + l.quantity);
  }

  const out = Array.from(totals.entries())
    .map(([itemLabel, totalQuantity]) => ({ itemLabel, totalQuantity }))
    .sort((a, b) => a.itemLabel.localeCompare(b.itemLabel));

  res.json(out);
});

const port = Number(process.env.PORT || 4318);
app.listen(port, () => {
  console.log(`[backend] listening on ${port}`);
});
