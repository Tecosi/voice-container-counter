import { useEffect, useMemo, useRef, useState } from "react";
import SpeechRecognition, { useSpeechRecognition } from "react-speech-recognition";

type ContainerLine = { id: string; itemLabel: string; quantity: number };
type Container = { id: string; label: string; lines: ContainerLine[] };

const API = "/api";

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(txt || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function normKey(s: string) {
  return s.trim().toLowerCase();
}

function normalizeMathSpeech(text: string) {
  let t = (text || "").toLowerCase();

  t = t.replace(/\bplus\b/g, "+");
  t = t.replace(/\bmoins\b/g, "-");
  t = t.replace(/\bfois\b/g, "*");
  t = t.replace(/\bmultiplie\b/g, "*");
  t = t.replace(/\bdivise\b/g, "/");
  t = t.replace(/\bdivisé\b/g, "/");
  t = t.replace(/\bpar\b/g, ""); // “divisé par”

  // 10 x 5 -> 10*5
  t = t.replace(/(\d)\s*x\s*(\d)/g, "$1*$2");

  // garder seulement chiffres + opérateurs
  t = t.replace(/[^0-9+\-*/().]/g, "");
  t = t.replace(/\s+/g, "");
  return t;
}

// eval safe (+ - * / parenthèses)
function evalExprSafe(expr: string): { value: number; error?: string } {
  const s = (expr || "").trim();
  if (!s) return { value: 0, error: "Expression vide" };
  let i = 0;

  function peek() { return s[i]; }
  function consume() { return s[i++]; }
  function skip() { while (s[i] === " ") i++; }

  function number(): number {
    skip();
    const start = i;
    while (i < s.length && /[0-9]/.test(s[i])) i++;
    if (start === i) throw new Error("Nombre attendu");
    return Number(s.slice(start, i));
  }

  function factor(): number {
    skip();
    if (peek() === "+") { consume(); return factor(); }
    if (peek() === "-") { consume(); return -factor(); }
    if (peek() === "(") {
      consume();
      const v = expr_();
      skip();
      if (peek() !== ")") throw new Error("Parenthèse manquante");
      consume();
      return v;
    }
    return number();
  }

  function term(): number {
    let v = factor();
    while (true) {
      skip();
      const c = peek();
      if (c === "*" || c === "/") {
        consume();
        const rhs = factor();
        v = c === "*" ? v * rhs : v / rhs;
      } else break;
    }
    return v;
  }

  function expr_(): number {
    let v = term();
    while (true) {
      skip();
      const c = peek();
      if (c === "+" || c === "-") {
        consume();
        const rhs = term();
        v = c === "+" ? v + rhs : v - rhs;
      } else break;
    }
    return v;
  }

  try {
    const v = expr_();
    skip();
    if (i < s.length) return { value: 0, error: `Caractère inattendu: "${s[i]}"` };
    if (!Number.isFinite(v)) return { value: 0, error: "Résultat invalide" };
    return { value: v };
  } catch (e: any) {
    return { value: 0, error: e?.message || "Erreur de calcul" };
  }
}

export default function App() {
  const [containerLabel, setContainerLabel] = useState("Contenant 001");
  const [container, setContainer] = useState<Container | null>(null);

  const [activeItem, setActiveItem] = useState<string>("");
  const [exprDraft, setExprDraft] = useState<string>("");

  const [refInput, setRefInput] = useState("");
  const [qtyInput, setQtyInput] = useState<number>(1);

  const [summary, setSummary] = useState<Array<{ itemLabel: string; totalQuantity: number }>>([]);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("");

  const { transcript, finalTranscript, listening, resetTranscript, browserSupportsSpeechRecognition } =
    useSpeechRecognition();

  async function refreshContainer(id: string) {
    const c = await api<Container>(`/containers/${id}`);
    setContainer(c);
  }
  async function refreshSummary(id: string) {
    const s = await api<Array<{ itemLabel: string; totalQuantity: number }>>(`/containers/${id}/summary`);
    setSummary(s);
  }

  async function createContainer(label?: string) {
    const lbl = (label ?? containerLabel).trim();
    if (!lbl) return;
    setLoading(true);
    try {
      const c = await api<Container>("/containers", {
        method: "POST",
        body: JSON.stringify({ label: lbl }),
      });
      setContainer(c);
      setActiveItem("");
      setExprDraft("");
      setRefInput("");
      setQtyInput(1);
      setSummary([]);
      setStatus(`Contenant créé: ${c.label}`);
    } catch (e: any) {
      setStatus(`Erreur création contenant: ${e?.message || e}`);
    } finally {
      setLoading(false);
    }
  }

  async function addLine(itemLabel: string, quantity: number) {
    if (!container) return;
    await api<Container>(`/containers/${container.id}/lines`, {
      method: "POST",
      body: JSON.stringify({ itemLabel, quantity }),
    });
    await refreshContainer(container.id);
    await refreshSummary(container.id);
  }

  // --- Totaux locaux
  const totalsMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of container?.lines || []) {
      const k = normKey(l.itemLabel);
      m.set(k, (m.get(k) ?? 0) + l.quantity);
    }
    return m;
  }, [container?.lines]);

  const currentSubtotal = useMemo(() => {
    if (!activeItem.trim()) return 0;
    return totalsMap.get(normKey(activeItem)) ?? 0;
  }, [activeItem, totalsMap]);

  const exprEval = useMemo(() => evalExprSafe(exprDraft), [exprDraft]);

  // --- STREAM PARSER : OK = séparateur
  const processedLenRef = useRef(0);
  const bufferRef = useRef("");

  async function handleSegment(raw: string) {
    const seg = raw.trim();
    if (!seg) return;

    const low = seg.toLowerCase().trim();

    // 1) contenant / carton
    if (low.startsWith("contenant") || low.startsWith("container") || low.startsWith("carton") || low.startsWith("bac")) {
      const label = seg.replace(/^(\s*(contenant|container|carton|bac)\s*)/i, "").trim() || containerLabel;
      setContainerLabel(label);
      await createContainer(label);
      return;
    }

    // 2) référence
    if (low.startsWith("référence") || low.startsWith("reference") || low.startsWith("ref") || low.startsWith("article")) {
      const label = seg.replace(/^(\s*(référence|reference|ref|article)\s*)/i, "").trim();
      if (!label) {
        setStatus("Référence vide (dis: “référence … OK”)");
        return;
      }
      setActiveItem(label);
      setRefInput(label);
      setExprDraft("");
      setQtyInput(1);
      setStatus(`Référence active: ${label}`);
      return;
    }

    // 3) sinon => calcul (si référence active)
    if (!activeItem.trim()) {
      setStatus(`Aucune référence active. Dis: “référence … OK” puis ton calcul “5+10 … OK”. (Segment: "${seg}")`);
      return;
    }

    const expr = normalizeMathSpeech(seg);
    setExprDraft(expr);

    const r = evalExprSafe(expr);
    if (r.error) {
      setStatus(`Erreur calcul: ${r.error} (segment="${seg}")`);
      return;
    }
    if (r.value <= 0) {
      setStatus(`Résultat <= 0 (${r.value}) : rien ajouté.`);
      return;
    }

    setQtyInput(r.value);
    setStatus(`Ajout: ${r.value} × ${activeItem}`);
    await addLine(activeItem, r.value);
    setExprDraft(""); // prêt pour le prochain calcul
  }

  async function processBuffer() {
    // Séparateurs OK
    const okRe = /\b(ok|okay|okey|d'accord|dac)\b/i;

    let buf = bufferRef.current;

    // tant qu’il y a un OK, on traite “segment + OK”
    while (true) {
      const m = okRe.exec(buf);
      if (!m) break;

      const seg = buf.slice(0, m.index).trim();
      buf = buf.slice(m.index + m[0].length).trim();

      // traiter segment
      try {
        await handleSegment(seg);
      } catch (e: any) {
        setStatus(`Erreur traitement segment: ${e?.message || e}`);
      }
    }

    bufferRef.current = buf;
  }

  useEffect(() => {
    const ft = finalTranscript || "";
    if (ft.length <= processedLenRef.current) return;

    const newPart = ft.slice(processedLenRef.current);
    processedLenRef.current = ft.length;

    bufferRef.current = (bufferRef.current + " " + newPart).trim();

    void processBuffer();
  }, [finalTranscript]);

  useEffect(() => {
    if (container) void refreshSummary(container.id);
  }, [container?.id]);

  if (!browserSupportsSpeechRecognition) {
    return (
      <div style={{ padding: 24, fontFamily: "system-ui, Arial" }}>
        <h1>Voice Container Counter</h1>
        <p>Le navigateur ne supporte pas Web Speech API.</p>
      </div>
    );
  }

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, Arial", maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ marginBottom: 4 }}>Voice Container Counter</h1>
      <div style={{ color: "#555", marginBottom: 16 }}>
        Dictée pilotée par <b>OK</b> : <b>référence … OK</b> puis <b>calcul … OK</b>
      </div>

      {/* Contenant */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Contenant</h2>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <input
            value={containerLabel}
            onChange={(e) => setContainerLabel(e.target.value)}
            style={{ flex: 1, padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <button
            onClick={() => void createContainer()}
            disabled={loading}
            style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: "#111", color: "white", cursor: "pointer" }}
          >
            Créer un contenant
          </button>
        </div>

        <div style={{ marginTop: 10, color: "#333" }}>
          <div><b>ID</b> : {container?.id || "—"}</div>
          <div><b>Label</b> : {container?.label || "—"}</div>
        </div>

        <div style={{ marginTop: 10, color: "#333" }}>
          <b>Référence active :</b> {activeItem ? activeItem : "—"}
        </div>

        <div style={{ marginTop: 8, color: "#666", fontSize: 13 }}>
          Exemple : “<b>référence vis M6x20</b> OK” puis “<b>5 plus 10 plus 20 fois 2</b> OK”
        </div>
      </div>

      {/* Dictée */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Dictée</h2>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          <button
            onClick={() => {
              if (listening) SpeechRecognition.stopListening();
              else SpeechRecognition.startListening({ continuous: true, language: "fr-FR" });
            }}
            style={{ padding: "10px 14px", borderRadius: 10, border: "none", background: listening ? "#b00020" : "#0b6", color: "white", cursor: "pointer" }}
          >
            {listening ? "Arrêter la dictée" : "Démarrer la dictée"}
          </button>

          <button
            onClick={() => {
              resetTranscript();
              processedLenRef.current = 0;
              bufferRef.current = "";
              setStatus("Transcript reset.");
            }}
            style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid #ddd", background: "white", cursor: "pointer" }}
          >
            Effacer
          </button>

          <div style={{ marginLeft: "auto", color: "#666" }}>
            Statut : {listening ? "🎙️ écoute" : "⏸️ stop"}
          </div>
        </div>

        <div style={{ marginTop: 12, padding: 12, border: "1px dashed #ddd", borderRadius: 10, background: "#fafafa", minHeight: 54 }}>
          <div style={{ color: "#666", fontSize: 13, marginBottom: 6 }}>Transcription :</div>
          <div style={{ whiteSpace: "pre-wrap" }}>{transcript || "—"}</div>
        </div>

        <div style={{ marginTop: 10, color: "#333" }}>
          <b>Buffer (en attente d’un OK)</b> : <span style={{ color: "#666" }}>{bufferRef.current || "—"}</span>
        </div>

        {status && (
          <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: "1px solid #eee", background: "#fff" }}>
            <b>Info</b> : {status}
          </div>
        )}
      </div>

      {/* Atelier */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Atelier : référence + calcul</h2>

        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10, alignItems: "end" }}>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Référence (active)</div>
            <input
              value={activeItem}
              onChange={(e) => setActiveItem(e.target.value)}
              placeholder="ex: vis M6x20"
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Quantité (dernier ajout)</div>
            <input
              type="number"
              value={Number.isFinite(qtyInput) ? qtyInput : 0}
              onChange={(e) => setQtyInput(Number(e.target.value))}
              style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
            />
          </div>

          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Sous-total</div>
            <div style={{ padding: 10, borderRadius: 10, border: "1px solid #ddd", background: "white", fontWeight: 800 }}>
              {currentSubtotal}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, color: "#666", marginBottom: 6 }}>Calcul (dernier segment normalisé)</div>
          <input
            value={exprDraft}
            onChange={(e) => setExprDraft(normalizeMathSpeech(e.target.value))}
            placeholder="ex: 5+10+20*2-12"
            style={{ width: "100%", padding: 10, borderRadius: 10, border: "1px solid #ddd" }}
          />
          <div style={{ marginTop: 6, color: exprEval.error ? "#b00020" : "#444" }}>
            {exprEval.error ? `Erreur: ${exprEval.error}` : `Résultat: ${exprEval.value}`}
          </div>
        </div>
      </div>

      {/* Résumé */}
      <div style={{ border: "1px solid #eee", borderRadius: 12, padding: 16, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>Résumé (totaux par article)</h2>

        {!container ? (
          <div style={{ color: "#666" }}>Aucun total.</div>
        ) : summary.length === 0 ? (
          <div style={{ color: "#666" }}>Aucun total.</div>
        ) : (
          <div style={{ marginTop: 10 }}>
            {summary.map((s) => (
              <div key={s.itemLabel} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f2f2f2" }}>
                <div>{s.itemLabel}</div>
                <div style={{ fontWeight: 700 }}>{s.totalQuantity}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ color: "#777", fontSize: 12 }}>
        Astuce : dicte en segments courts séparés par “OK”. Exemple : “référence vis M6x20 OK”… pause… “5 plus 10 plus 20 OK”.
      </div>
    </div>
  );
}
