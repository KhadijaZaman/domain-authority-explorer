import { ReplitConnectors } from "@replit/connectors-sdk";
import fs from "node:fs";

const connectors = new ReplitConnectors();
const md = fs.readFileSync("docs/how-it-works-and-benchmark.md", "utf8");

// --- parse markdown into blocks ---
const lines = md.split("\n");
const blocks = [];
let tableRows = [];
const flushTable = () => {
  if (tableRows.length > 2) {
    for (const row of tableRows.slice(2)) {
      blocks.push({ type: "bullet", raw: `**${row[0]}** — This tool: ${row[1]} | metehan.ai: ${row[2]}` });
    }
  }
  tableRows = [];
};
for (const line of lines) {
  const t = line.trim();
  if (t.startsWith("|")) { tableRows.push(t.split("|").slice(1, -1).map((c) => c.trim().replace(/\*\*/g, ""))); continue; }
  flushTable();
  if (!t || t === "---") continue;
  if (t.startsWith("### ")) blocks.push({ type: "h3", raw: t.slice(4) });
  else if (t.startsWith("## ")) blocks.push({ type: "h2", raw: t.slice(3) });
  else if (t.startsWith("# ")) blocks.push({ type: "h1", raw: t.slice(2) });
  else if (t.startsWith("- ")) blocks.push({ type: "bullet", raw: t.slice(2) });
  else blocks.push({ type: "p", raw: t });
}
flushTable();

const clean = (raw) => {
  let text = "", bolds = [], i = 0, boldStart = -1;
  raw = raw.replace(/`/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "$1");
  while (i < raw.length) {
    if (raw.startsWith("**", i)) {
      if (boldStart < 0) boldStart = text.length;
      else { bolds.push([boldStart, text.length]); boldStart = -1; }
      i += 2;
    } else text += raw[i++];
  }
  return { text, bolds };
};

let full = "", idx = 1;
const styleReqs = [], bulletRanges = [];
for (const b of blocks) {
  const { text, bolds } = clean(b.raw);
  const start = idx;
  full += text + "\n";
  const end = start + text.length;
  idx = end + 1;
  if (b.type[0] === "h") {
    const named = { h1: "HEADING_1", h2: "HEADING_2", h3: "HEADING_3" }[b.type];
    styleReqs.push({ updateParagraphStyle: { range: { startIndex: start, endIndex: end + 1 }, paragraphStyle: { namedStyleType: named }, fields: "namedStyleType" } });
  }
  if (b.type === "bullet") bulletRanges.push([start, end + 1]);
  for (const [s, e] of bolds) if (e > s) styleReqs.push({ updateTextStyle: { range: { startIndex: start + s, endIndex: start + e }, textStyle: { bold: true }, fields: "bold" } });
}
const bulletReqs = [];
let cur = null;
for (const r of bulletRanges) {
  if (cur && r[0] === cur[1]) cur[1] = r[1];
  else { if (cur) bulletReqs.push(cur); cur = [...r]; }
}
if (cur) bulletReqs.push(cur);
const bulletStyleReqs = bulletReqs.map(([s, e]) => ({ createParagraphBullets: { range: { startIndex: s, endIndex: e }, bulletPreset: "BULLET_DISC_CIRCLE_SQUARE" } }));

const createRes = await connectors.proxy("google-docs", "/v1/documents", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ title: "Domain Authority Explorer — How It Works & Benchmark" }),
});
const doc = await createRes.json();
if (!doc.documentId) { console.error("CREATE FAILED:", JSON.stringify(doc).slice(0, 500)); process.exit(1); }

const requests = [{ insertText: { location: { index: 1 }, text: full } }, ...styleReqs, ...bulletStyleReqs];
const upRes = await connectors.proxy("google-docs", `/v1/documents/${doc.documentId}:batchUpdate`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ requests }),
});
if (!upRes.ok) { console.error("UPDATE FAILED:", (await upRes.text()).slice(0, 600)); process.exit(1); }
console.log("DOC_URL=https://docs.google.com/document/d/" + doc.documentId + "/edit");
