"use strict";

// Mode révision (répétition espacée) du QCM FFVL.
// Étape 1 : choix de l'examen (activité + niveau) si aucun état n'existe en
// localStorage, ou import d'une sauvegarde JSON. Le modèle de données est posé
// pour les étapes suivantes (révision carte par carte + algorithme SRS).

const DATA_URL = "./data/qcm_ffvl.json";
const EXPLANATIONS_URL = "./data/explanations.json";

// Clé de l'état de révision en localStorage. Le suffixe de version permet de
// faire évoluer le format sans casser d'anciennes sauvegardes.
const STATE_KEY = "qcm-ffvl:srs:v1";
const SCHEMA = 1;
// Nombre maximum de cartes proposées par session de révision.
const SESSION_LIMIT = 20;
// Millisecondes par jour, pour les échéances SRS.
const DAY_MS = 86400000;

// Ordre d'affichage des niveaux (du plus simple au plus avancé).
const LEVEL_ORDER = [
  "Brevet Initial",
  "Brevet de Pilote",
  "Brevet de Pilote Confirmé",
  "Qualification Treuil",
];

let QUESTIONS = [];
let BY_CODE = {};
let state = null;
let session = null;

const app = document.getElementById("app");

init();

async function init() {
  try {
    const resp = await fetch(DATA_URL);
    if (!resp.ok) throw new Error("HTTP " + resp.status);
    const data = await resp.json();
    QUESTIONS = data.questions || [];
    BY_CODE = Object.fromEntries(QUESTIONS.map((q) => [q.code, q]));

    // Explications (optionnelles) rattachées aux questions par leur code.
    try {
      const expResp = await fetch(EXPLANATIONS_URL);
      if (expResp.ok) {
        const byCode = (await expResp.json()).explanations || {};
        for (const q of QUESTIONS) if (byCode[q.code]) q.explanation = byCode[q.code];
      }
    } catch (_) {
      /* explications indisponibles : on continue sans */
    }
  } catch (err) {
    app.innerHTML =
      '<p class="error">Impossible de charger les questions (' +
      escapeHtml(String(err)) +
      ").</p>";
    return;
  }

  state = loadState();
  document.addEventListener("keydown", onGlobalKey);
  route();
}

// ---------- État (localStorage) ----------

function loadState() {
  let raw = null;
  try {
    raw = localStorage.getItem(STATE_KEY);
  } catch (_) {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return isValidState(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function saveState() {
  if (!state) return;
  state.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch (_) {
    /* localStorage indisponible (navigation privée, quota) : on ignore */
  }
}

function clearState() {
  state = null;
  try {
    localStorage.removeItem(STATE_KEY);
  } catch (_) {
    /* ignore */
  }
}

// Valide la forme minimale d'un état (pour le chargement et l'import).
function isValidState(s) {
  return (
    s &&
    typeof s === "object" &&
    s.deck &&
    typeof s.deck.activity === "string" &&
    typeof s.deck.level === "string" &&
    s.cards &&
    typeof s.cards === "object"
  );
}

// ---------- Construction d'un deck ----------

function questionsFor(activity, level) {
  return QUESTIONS.filter(
    (q) => q.activities.includes(activity) && q.levels.includes(level),
  );
}

// État initial d'une carte (les champs servent à l'algorithme SRS des étapes
// suivantes). due = échéance (ms epoch) ; 0 = à réviser tout de suite.
function newCard() {
  return { reps: 0, lapses: 0, intervalDays: 0, ease: 2.5, due: 0, lastGrade: null };
}

function createDeck(activity, level) {
  const codes = questionsFor(activity, level).map((q) => q.code);
  const cards = {};
  for (const code of codes) cards[code] = newCard();
  const now = new Date().toISOString();
  state = {
    schema: SCHEMA,
    deck: { activity, level },
    createdAt: now,
    updatedAt: now,
    cards,
  };
  saveState();
  route();
}

// ---------- Routage des écrans ----------

function route() {
  if (!state) renderOnboarding();
  else renderDeckHome();
}

// ---------- Écran 1 : choix de l'examen / import ----------

function renderOnboarding() {
  const activities = unique(QUESTIONS.flatMap((q) => q.activities)).sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
  const levels = sortedLevels(unique(QUESTIONS.flatMap((q) => q.levels)));

  app.innerHTML =
    '<div class="card onboarding">' +
    "<h2>Choisis ton examen</h2>" +
    '<p class="muted">Sélectionne une activité et un niveau pour créer ton deck de révision. ' +
    "Ta progression sera mémorisée dans ce navigateur.</p>" +
    '<div class="form-row">' +
    '<label class="field"><span>Activité</span>' +
    '<select id="o-activity">' +
    activities.map((a) => `<option value="${escapeHtml(a)}">${escapeHtml(a)}</option>`).join("") +
    "</select></label>" +
    '<label class="field"><span>Examen / Niveau</span>' +
    '<select id="o-level">' +
    levels.map((l) => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("") +
    "</select></label>" +
    "</div>" +
    '<p class="count-preview" id="o-count"></p>' +
    '<button class="btn btn-primary" id="o-create" type="button">Créer le deck et commencer</button>' +
    '<div class="sep"><span>ou</span></div>' +
    '<div class="import-block">' +
    "<p class=\"muted\">Tu as déjà une sauvegarde ? Importe ton fichier <code>.json</code> pour retrouver ta progression.</p>" +
    '<input type="file" id="o-import" accept="application/json,.json" hidden />' +
    '<button class="btn" id="o-import-btn" type="button">Importer une sauvegarde…</button>' +
    '<p class="import-msg" id="o-import-msg" hidden></p>' +
    "</div>" +
    "</div>";

  const actSel = document.getElementById("o-activity");
  const lvlSel = document.getElementById("o-level");
  const countEl = document.getElementById("o-count");

  // Pré-sélection pratique : Parapente + Brevet Initial si disponibles.
  if (activities.includes("Parapente")) actSel.value = "Parapente";
  if (levels.includes("Brevet Initial")) lvlSel.value = "Brevet Initial";

  const updateCount = () => {
    const n = questionsFor(actSel.value, lvlSel.value).length;
    countEl.textContent =
      n > 0
        ? `${n} question${n > 1 ? "s" : ""} dans ce deck.`
        : "Aucune question pour cette combinaison.";
    document.getElementById("o-create").disabled = n === 0;
  };
  actSel.addEventListener("input", updateCount);
  lvlSel.addEventListener("input", updateCount);
  updateCount();

  document.getElementById("o-create").addEventListener("click", () => {
    createDeck(actSel.value, lvlSel.value);
  });

  // Import.
  const fileInput = document.getElementById("o-import");
  document
    .getElementById("o-import-btn")
    .addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) importStateFromFile(file, document.getElementById("o-import-msg"));
  });
}

// ---------- Écran 2 : accueil du deck (résumé) ----------

function renderDeckHome() {
  const codes = Object.keys(state.cards);
  const total = codes.length;
  const now = Date.now();
  const due = codes.filter((c) => (state.cards[c].due || 0) <= now).length;
  const fresh = codes.filter((c) => (state.cards[c].reps || 0) === 0).length;

  app.innerHTML =
    '<div class="card deck-home">' +
    '<span class="deck-badge">' +
    escapeHtml(state.deck.activity) +
    " · " +
    escapeHtml(state.deck.level) +
    "</span>" +
    "<h2>Ton deck est prêt</h2>" +
    '<div class="stats">' +
    `<div class="stat"><span class="stat-num">${total}</span><span class="stat-lbl">cartes</span></div>` +
    `<div class="stat"><span class="stat-num">${due}</span><span class="stat-lbl">à réviser</span></div>` +
    `<div class="stat"><span class="stat-num">${fresh}</span><span class="stat-lbl">jamais vues</span></div>` +
    "</div>" +
    `<button class="btn btn-primary" id="d-start" type="button"${due === 0 ? " disabled" : ""}>` +
    (due === 0
      ? "Rien à réviser pour l'instant"
      : `Réviser ${Math.min(due, SESSION_LIMIT)} carte${Math.min(due, SESSION_LIMIT) > 1 ? "s" : ""}`) +
    "</button>" +
    '<p class="muted next-step">Tu révèles la réponse, puis tu t\'auto-évalues : ' +
    "<b>Pas</b> / <b>Bof</b> / <b>Bien</b>. La carte est reprogrammée en conséquence.</p>" +
    '<div class="deck-actions">' +
    '<button class="btn" id="d-export" type="button">Exporter ma progression</button>' +
    '<input type="file" id="d-import" accept="application/json,.json" hidden />' +
    '<button class="btn" id="d-import-btn" type="button">Importer…</button>' +
    '<button class="btn btn-danger" id="d-reset" type="button">Changer d\'examen</button>' +
    "</div>" +
    '<p class="import-msg" id="d-import-msg" hidden></p>' +
    "</div>";

  const startBtn = document.getElementById("d-start");
  if (startBtn && !startBtn.disabled) startBtn.addEventListener("click", startSession);

  document.getElementById("d-export").addEventListener("click", exportState);

  const fileInput = document.getElementById("d-import");
  document
    .getElementById("d-import-btn")
    .addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) importStateFromFile(file, document.getElementById("d-import-msg"));
  });

  document.getElementById("d-reset").addEventListener("click", () => {
    if (
      confirm(
        "Changer d'examen effacera ta progression actuelle (pense à l'exporter d'abord). Continuer ?",
      )
    ) {
      clearState();
      route();
    }
  });
}

// ---------- Écran 3 : session de révision ----------

// Codes des cartes dues (échéance passée), de la plus en retard à la moins.
function dueCodes() {
  const now = Date.now();
  return Object.keys(state.cards)
    .filter((c) => BY_CODE[c] && (state.cards[c].due || 0) <= now)
    .sort((a, b) => (state.cards[a].due || 0) - (state.cards[b].due || 0));
}

function startSession() {
  const due = dueCodes();
  if (due.length === 0) {
    renderDeckHome();
    return;
  }
  session = { queue: due.slice(0, SESSION_LIMIT), grades: { pas: 0, bof: 0, bien: 0 }, reviewed: 0 };
  renderCard();
}

// Algorithme SRS simplifié : calcule le nouvel état d'une carte selon la note.
//  - Pas  : échec, revient dans la même session (~1 min), ease abaissé, lapse.
//  - Bof  : réussite difficile, intervalle qui croît lentement, ease abaissé.
//  - Bien : réussite, intervalle multiplié par l'ease.
function schedule(card, grade) {
  const now = Date.now();
  let { intervalDays = 0, ease = 2.5, reps = 0, lapses = 0 } = card;
  if (grade === "pas") {
    ease = Math.max(1.3, ease - 0.2);
    return { ...card, ease, reps, lapses: lapses + 1, intervalDays: 0, lastGrade: "pas", due: now + 60 * 1000 };
  }
  reps += 1;
  if (grade === "bof") {
    ease = Math.max(1.3, ease - 0.15);
    intervalDays = intervalDays < 1 ? 1 : Math.max(1, Math.round(intervalDays * 1.2));
  } else {
    intervalDays = intervalDays < 1 ? 1 : Math.max(1, Math.round(intervalDays * ease));
  }
  return { ...card, ease, reps, lapses, intervalDays, lastGrade: grade, due: now + intervalDays * DAY_MS };
}

// Aperçu du délai avant réapparition, affiché sur les boutons de notation.
function previewLabel(card, grade) {
  if (grade === "pas") return "< 1 min";
  const next = schedule(card, grade);
  return next.intervalDays <= 1 ? "1 j" : next.intervalDays + " j";
}

function renderCard() {
  if (!session || session.queue.length === 0) {
    endSession();
    return;
  }
  const code = session.queue[0];
  const q = BY_CODE[code];
  const card = state.cards[code];

  const answers = q.answers
    .map((a) => {
      const cls = a.pts > 0 ? "good" : "bad";
      const mark = a.pts > 0 ? "✓" : "✗";
      return (
        `<li class="answer ${cls}"><span class="mark">${mark}</span>` +
        `<span class="atext">${escapeHtml(a.text)}</span></li>`
      );
    })
    .join("");

  const explanation = q.explanation
    ? '<div class="explanation" id="r-explanation" hidden>' +
      `<span class="exp-label">Explication</span><p>${escapeHtml(q.explanation)}</p></div>`
    : "";

  app.innerHTML =
    '<div class="card review">' +
    '<div class="review-top">' +
    `<span class="deck-badge">${escapeHtml(state.deck.activity)} · ${escapeHtml(state.deck.level)}</span>` +
    `<span class="review-progress">${session.queue.length} en attente</span>` +
    "</div>" +
    `<p class="code-line"><span class="code">${escapeHtml(code)}</span>` +
    q.categories.map((c) => `<span class="tag cat">${escapeHtml(c)}</span>`).join("") +
    "</p>" +
    `<p class="qtext">${escapeHtml(q.question)}</p>` +
    `<ul class="answers ans-review" id="r-answers">${answers}</ul>` +
    explanation +
    '<div class="review-actions" id="r-reveal-wrap">' +
    '<button class="btn btn-primary" id="r-reveal" type="button">Afficher la réponse <small>(Espace)</small></button>' +
    "</div>" +
    '<div class="grade-buttons" id="r-grades" hidden>' +
    `<button class="btn grade-pas" data-g="pas" type="button">Pas<small>${previewLabel(card, "pas")}</small></button>` +
    `<button class="btn grade-bof" data-g="bof" type="button">Bof<small>${previewLabel(card, "bof")}</small></button>` +
    `<button class="btn grade-bien" data-g="bien" type="button">Bien<small>${previewLabel(card, "bien")}</small></button>` +
    "</div>" +
    '<div class="review-foot"><button class="btn-link" id="r-quit" type="button">Terminer la session</button></div>' +
    "</div>";

  document.getElementById("r-reveal").addEventListener("click", revealCard);
  for (const b of document.querySelectorAll("#r-grades [data-g]")) {
    b.addEventListener("click", () => gradeCard(b.getAttribute("data-g")));
  }
  document.getElementById("r-quit").addEventListener("click", endSession);
}

function revealCard() {
  const ans = document.getElementById("r-answers");
  if (!ans || ans.classList.contains("revealed")) return;
  ans.classList.add("revealed");
  const exp = document.getElementById("r-explanation");
  if (exp) exp.hidden = false;
  document.getElementById("r-reveal-wrap").hidden = true;
  document.getElementById("r-grades").hidden = false;
}

function gradeCard(grade) {
  if (!session || session.queue.length === 0) return;
  const ans = document.getElementById("r-answers");
  if (ans && !ans.classList.contains("revealed")) return; // noter après révélation
  const code = session.queue.shift();
  state.cards[code] = schedule(state.cards[code], grade);
  session.grades[grade] = (session.grades[grade] || 0) + 1;
  session.reviewed += 1;
  saveState();
  if (grade === "pas") session.queue.push(code); // revue dans la même session
  renderCard();
}

function endSession() {
  const g = session ? session.grades : { pas: 0, bof: 0, bien: 0 };
  const reviewed = session ? session.reviewed : 0;
  session = null;
  const remaining = dueCodes().length;
  app.innerHTML =
    '<div class="card review-done">' +
    "<h2>Session terminée 🎉</h2>" +
    `<p class="muted">${reviewed} révision${reviewed > 1 ? "s" : ""} effectuée${reviewed > 1 ? "s" : ""}.</p>` +
    '<div class="stats">' +
    `<div class="stat"><span class="stat-num">${g.bien}</span><span class="stat-lbl">Bien</span></div>` +
    `<div class="stat"><span class="stat-num">${g.bof}</span><span class="stat-lbl">Bof</span></div>` +
    `<div class="stat"><span class="stat-num">${g.pas}</span><span class="stat-lbl">Pas</span></div>` +
    "</div>" +
    (remaining > 0
      ? `<button class="btn btn-primary" id="s-again" type="button">Continuer (${Math.min(remaining, SESSION_LIMIT)})</button>`
      : '<p class="muted">Plus aucune carte due pour le moment. Reviens plus tard !</p>') +
    '<div class="deck-actions"><button class="btn" id="s-home" type="button">Retour au deck</button></div>' +
    "</div>";
  const again = document.getElementById("s-again");
  if (again) again.addEventListener("click", startSession);
  document.getElementById("s-home").addEventListener("click", renderDeckHome);
}

// Raccourcis clavier pendant la session : Espace/Entrée révèle, 1/2/3 notent.
function onGlobalKey(e) {
  const grades = document.getElementById("r-grades");
  const reveal = document.getElementById("r-reveal");
  if (grades && !grades.hidden) {
    if (e.key === "1") {
      e.preventDefault();
      gradeCard("pas");
    } else if (e.key === "2") {
      e.preventDefault();
      gradeCard("bof");
    } else if (e.key === "3") {
      e.preventDefault();
      gradeCard("bien");
    }
  } else if (reveal && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    revealCard();
  }
}

// ---------- Import / Export ----------

function exportState() {
  if (!state) return;
  const slug = (s) =>
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
  const name = `qcm-revision-${slug(state.deck.activity)}-${slug(state.deck.level)}-${
    new Date().toISOString().slice(0, 10)
  }.json`;
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function importStateFromFile(file, msgEl) {
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (_) {
      return showMsg(msgEl, "Fichier illisible : ce n'est pas un JSON valide.", "error");
    }
    if (!isValidState(parsed)) {
      return showMsg(msgEl, "Ce fichier n'est pas une sauvegarde de révision valide.", "error");
    }
    state = parsed;
    saveState();
    route();
  };
  reader.onerror = () => showMsg(msgEl, "Échec de lecture du fichier.", "error");
  reader.readAsText(file);
}

function showMsg(el, text, kind) {
  if (!el) return;
  el.hidden = false;
  el.className = "import-msg " + (kind || "info");
  el.textContent = text;
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
