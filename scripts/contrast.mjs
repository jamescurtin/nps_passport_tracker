#!/usr/bin/env node
// WCAG contrast audit for src/css/tokens.css. No dependencies.
// Usage: node scripts/contrast.mjs   (exit 1 on any failure)
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../src/css/tokens.css"),
  "utf8",
);

/** Return the body of the first block whose selector text matches `selector`. */
function block(selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced block: ${selector}`);
}

function decls(body) {
  const out = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    out[m[1]] = m[2].trim();
  }
  return out;
}

const light = decls(block(":root {"));
const lightAttr = decls(block(':root[data-theme="light"]'));
const darkMedia = decls(
  block("@media (prefers-color-scheme: dark) {").replace(/^[^{]*\{/, ""),
);
const darkAttr = decls(block(':root[data-theme="dark"]'));

const THEME_KEYS = Object.keys(darkMedia);
let failures = 0;

// The attribute blocks must mirror the media blocks exactly.
function sameDecls(a, b, label) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (a[k] !== b[k]) {
      console.log(`SYNC FAIL ${label}: ${k}: "${a[k]}" vs "${b[k]}"`);
      failures++;
    }
  }
}
sameDecls(darkMedia, darkAttr, "dark media vs [data-theme=dark]");
for (const k of Object.keys(lightAttr)) {
  if (light[k] !== lightAttr[k]) {
    console.log(`SYNC FAIL light: ${k}: "${light[k]}" vs "${lightAttr[k]}"`);
    failures++;
  }
}
for (const k of THEME_KEYS) {
  if (!(k in lightAttr)) {
    console.log(`SYNC FAIL light attr missing ${k}`);
    failures++;
  }
}

const themes = {
  light: { ...light },
  dark: { ...light, ...darkMedia },
};

function parseColor(value, tokens) {
  const v = value.trim();
  let m = v.match(/^var\((--[\w-]+)\)$/);
  if (m) return parseColor(tokens[m[1]], tokens);
  m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    const n = parseInt(h, 16);
    return { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/);
  if (m) {
    let a = m[4] === undefined ? 1 : parseFloat(m[4]);
    if (m[5] === "%") a /= 100;
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  throw new Error(`cannot parse color: ${value}`);
}

const over = (top, bottom) => ({
  r: top.r * top.a + bottom.r * (1 - top.a),
  g: top.g * top.a + bottom.g * (1 - top.a),
  b: top.b * top.a + bottom.b * (1 - top.a),
  a: 1,
});

function luminance({ r, g, b }) {
  const f = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// kind: "text" needs 4.5, "nontext" needs 3, "info" is reported only.
// Colors may be a token name or { token, over: token } (alpha composite).
const PAIRS = [
  ["text", "--ink", "--surface", "body text on sheets"],
  ["text", "--ink-2", "--surface", "secondary text on sheets"],
  ["text", "--accent", "--surface", "error box text / accent text on sheets"],
  ["text", "--ink", "--surface-2", "text on nested cards"],
  ["text", "--ink-2", "--surface-2", "secondary text / chip on nested card"],
  ["text", "--on-accent", "--accent", "primary button"],
  ["text", "--on-accent", "--visited", "visited chip, progress label"],
  ["text", "--visited", "--surface", "visited text on sheets"],
  ["text", "--ink", "--ocean", "tooltip/legend text over ocean"],
  ["text", "--ink-2", "--ocean", "secondary text over ocean"],
  ["text", "--ink", "--land", "text over land"],
  ["text", "--ink", "--land-complete", "text over complete state"],
  ["text", "--ink", "@scrim/--surface", "text on scrim-covered surface"],
  ["text", "--ink", "@glass/--ocean", "header/toolbar glass over ocean"],
  ["text", "--ink-2", "@glass/--ocean", "secondary glass text over ocean"],
  ["text", "--ink-2", "--surface", "chart axis/label on sheet"],
  ["nontext", "--visited", "--land", "visited marker on land"],
  ["nontext", "--not-visited", "--land", "not-visited marker on land"],
  ["nontext", "--visited", "--land-complete", "visited marker on complete"],
  ["nontext", "--not-visited", "--land-complete", "not-visited on complete"],
  ["nontext", "--visited", "--ocean", "visited marker over ocean"],
  ["nontext", "--not-visited", "--ocean", "not-visited marker over ocean"],
  ["nontext", "--danger", "--land", "address pin / highlight on land"],
  ["nontext", "--danger", "--ocean", "address pin / highlight over ocean"],
  ["nontext", "--border-map", "--land", "state border on land"],
  ["nontext", "--ink-2", "--land", "mesh stroke (ink-2) on land"],
  ["nontext", "--ink-2", "--ocean", "outline stroke (ink-2) over ocean"],
  ["nontext", "--visited", "--surface", "focus ring on sheets"],
  ["nontext", "--visited", "--ocean", "focus ring over ocean"],
  ["nontext", "--visited", "--surface-2", "progress bar fill on track"],
  // Informational: fills are separated by strokes, not by fill contrast alone.
  ["info", "--land-complete", "--ocean", "complete fill vs ocean"],
  ["info", "--land", "--ocean", "land fill vs ocean"],
  ["info", "--land-complete", "--land", "complete fill vs plain land"],
];

function resolve(spec, tokens) {
  const m = spec.match(/^@(scrim|glass)\/(--[\w-]+)$/);
  if (!m) return parseColor(`var(${spec})`, tokens);
  const base = parseColor(`var(${m[2]})`, tokens);
  if (m[1] === "scrim")
    return over(parseColor(tokens["--scrim"], tokens), base);
  // glass: 80% surface over the map underneath (header/toolbar)
  const glass = { ...parseColor(tokens["--surface"], tokens), a: 0.8 };
  return over(glass, base);
}

const rows = [];
for (const [themeName, tokens] of Object.entries(themes)) {
  for (const [kind, fg, bg, note] of PAIRS) {
    const min = { text: 4.5, nontext: 3, info: 0 }[kind];
    const r = ratio(resolve(fg, tokens), resolve(bg, tokens));
    const ok = r >= min;
    if (!ok) failures++;
    rows.push({ themeName, kind, fg, bg, note, r, min, ok });
  }
}

const pad = (s, n) => String(s).padEnd(n);
console.log(
  `${pad("theme", 6)}${pad("kind", 9)}${pad("foreground", 14)}${pad("background", 22)}${pad("ratio", 8)}${pad("min", 5)}result  note`,
);
for (const x of rows) {
  console.log(
    `${pad(x.themeName, 6)}${pad(x.kind, 9)}${pad(x.fg, 14)}${pad(x.bg, 22)}${pad(x.r.toFixed(2), 8)}${pad(x.min, 5)}${x.ok ? "ok    " : "FAIL  "}  ${x.note}`,
  );
}
console.log(failures ? `\n${failures} failure(s)` : "\nAll pairs pass.");
process.exit(failures ? 1 : 0);
