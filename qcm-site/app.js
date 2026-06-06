"use strict";

// Consultation des questions du QCM FFVL.
// Données statiques chargées depuis ./data/qcm_ffvl.json (généré par le scraper).

const DATA_URL = "./data/qcm_ffvl.json";
// Explications pédagogiques (brevet initial parapente), indexées par code question.
const EXPLANATIONS_URL = "./data/explanations.json";

// Ordre d'affichage des niveaux (du plus simple au plus avancé) + treuil.
const LEVEL_ORDER = [
  "Brevet Initial",
  "Brevet de Pilote",
  "Brevet de Pilote Confirmé",
  "Qualification Treuil",
];

const els = {
  version: document.getElementById("version-tag"),
  search: document.getElementById("f-search"),
  activity: document.getElementById("f-activity"),
  level: document.getElementById("f-level"),
  category: document.getElementById("f-category"),
  reveal: document.getElementById("f-reveal"),
  reset: document.getElementById("f-reset"),
  count: document.getElementById("count"),
  list: document.getElementById("questions"),
  empty: document.getElementById("empty"),
};

let QUESTIONS = [];
// Lien optionnel « pour aller plus loin » vers la page pédagogique sur les
// nuages, ajouté dans l'explication des questions concernées (cf. explanations.json).
let CLOUD_LINK = null; // { page, label, codes: { CODE: "ancre" } }

init();

async function init() {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    QUESTIONS = data.questions || [];
    els.version.textContent = "v" + (data.version || "?");

    // Charge les explications (fichier séparé, optionnel) et les rattache aux
    // questions par leur code. Une erreur ici ne doit pas empêcher l'affichage.
    try {
      const expResp = await fetch(EXPLANATIONS_URL);
      if (expResp.ok) {
        const exp = await expResp.json();
        const byCode = exp.explanations || {};
        for (const q of QUESTIONS) {
          if (byCode[q.code]) q.explanation = byCode[q.code];
        }
        if (exp.nuages_link && exp.nuages_link.codes) CLOUD_LINK = exp.nuages_link;
      }
    } catch (_) {
      /* explications indisponibles : on continue sans */
    }
  } catch (err) {
    els.list.innerHTML =
      '<p class="empty">Impossible de charger les données (' +
      escapeHtml(String(err)) +
      ").</p>";
    return;
  }

  populateSelect(els.level, sortedLevels(unique(QUESTIONS.flatMap((q) => q.levels))));
  populateSelect(
    els.category,
    unique(QUESTIONS.flatMap((q) => q.categories)).sort((a, b) => a.localeCompare(b, "fr")),
  );

  for (const el of [els.search, els.activity, els.level, els.category, els.reveal]) {
    el.addEventListener("input", render);
  }
  els.reset.addEventListener("click", () => {
    els.search.value = "";
    els.activity.value = "";
    els.level.value = "";
    els.category.value = "";
    els.reveal.checked = true;
    render();
  });

  render();
}

function render() {
  const term = els.search.value.trim().toLowerCase();
  const activity = els.activity.value;
  const level = els.level.value;
  const category = els.category.value;
  const reveal = els.reveal.checked;

  const filtered = QUESTIONS.filter((q) => {
    if (activity && !q.activities.includes(activity)) return false;
    if (level && !q.levels.includes(level)) return false;
    if (category && !q.categories.includes(category)) return false;
    if (term && !matchesTerm(q, term)) return false;
    return true;
  });

  els.count.textContent = filtered.length.toLocaleString("fr-FR");
  els.empty.hidden = filtered.length !== 0;

  // Rendu en une passe via innerHTML pour la rapidité (854 questions max).
  els.list.innerHTML = filtered.map((q) => cardHtml(q, term, reveal)).join("");
}

function matchesTerm(q, term) {
  if (q.code.toLowerCase().includes(term)) return true;
  if (q.question.toLowerCase().includes(term)) return true;
  return q.answers.some((a) => a.text.toLowerCase().includes(term));
}

function cardHtml(q, term, reveal) {
  const tags = [
    ...q.activities.map((a) => `<span class="tag">${escapeHtml(a)}</span>`),
    ...q.levels.map((l) => `<span class="tag">${escapeHtml(l)}</span>`),
    ...q.categories.map((c) => `<span class="tag cat">${escapeHtml(c)}</span>`),
  ].join("");

  const answers = q.answers
    .map((a) => {
      const good = a.pts > 0;
      const cls = good ? "good" : "bad";
      const mark = good ? "✓" : "✗";
      const pts = (a.pts > 0 ? "+" : "") + a.pts;
      return (
        `<li class="answer ${cls}">` +
        `<span class="mark">${mark}</span>` +
        `<span class="atext">${highlight(a.text, term)}</span>` +
        `<span class="pts">${pts} pts</span>` +
        `</li>`
      );
    })
    .join("");

  const explanation = q.explanation
    ? `<div class="explanation">` +
      `<span class="exp-label">Explication</span>` +
      `<p>${highlight(q.explanation, term)}</p>` +
      cloudLinkHtml(q.code) +
      `</div>`
    : "";

  return (
    `<article class="qcard${reveal ? " reveal" : ""}">` +
    `<div class="qcard-head"><span class="code">${escapeHtml(q.code)}</span>${tags}</div>` +
    `<p class="qtext">${highlight(q.question, term)}</p>` +
    `<ul class="answers">${answers}</ul>` +
    explanation +
    `</article>`
  );
}

// Lien vers la page pédagogique sur les nuages, pour les questions « nuage ».
// L'ancre permet d'arriver directement sur la bonne section (étage, cumulonimbus…).
function cloudLinkHtml(code) {
  if (!CLOUD_LINK || !CLOUD_LINK.codes || !(code in CLOUD_LINK.codes)) return "";
  const anchor = CLOUD_LINK.codes[code];
  const href = CLOUD_LINK.page + (anchor ? "#" + anchor : "");
  const label = CLOUD_LINK.label || "En savoir plus sur les nuages";
  return (
    `<a class="exp-link" href="${escapeHtml(href)}">` +
    `<span class="exp-link-icon" aria-hidden="true">☁</span>` +
    `${escapeHtml(label)} <span class="exp-link-arrow" aria-hidden="true">→</span>` +
    `</a>`
  );
}

// ---------- Helpers ----------

function unique(arr) {
  return [...new Set(arr)];
}

function sortedLevels(levels) {
  return levels.slice().sort((a, b) => {
    const ia = LEVEL_ORDER.indexOf(a);
    const ib = LEVEL_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b, "fr");
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

function populateSelect(select, values) {
  for (const v of values) {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    select.appendChild(opt);
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Échappe puis surligne les occurrences du terme de recherche.
function highlight(text, term) {
  const safe = escapeHtml(text);
  if (!term) return safe;
  const re = new RegExp("(" + escapeRegExp(escapeHtml(term)) + ")", "gi");
  return safe.replace(re, "<mark>$1</mark>");
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
