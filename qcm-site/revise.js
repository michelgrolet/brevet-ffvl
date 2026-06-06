"use strict";

// Mode révision (apprentissage intensif) du QCM FFVL.
// On choisit un examen (activité + niveau) — ou on importe une sauvegarde — puis
// on révise carte par carte. Le deck contient TOUJOURS toutes les questions de
// l'examen, mais une session ne fait défiler que les cartes pas encore sues
// « par cœur », des moins maîtrisées (début) aux mieux connues (fin). Seule la
// note « ★ Par cœur » fait sortir une carte ; « en attente » (file) et « sues »
// sont donc complémentaires : en attente + sues = total. La progression (champs
// SRS par carte) est mémorisée en localStorage, rétro-compatible avec les sauvegardes v1.

const DATA_URL = "./data/qcm_ffvl.json";
const EXPLANATIONS_URL = "./data/explanations.json";

// Clé de l'état de révision en localStorage. Le suffixe de version permet de
// faire évoluer le format sans casser d'anciennes sauvegardes.
const STATE_KEY = "qcm-ffvl:srs:v1";
const SCHEMA = 1;
// Millisecondes par jour, pour les échéances SRS (mémoire long terme des cartes).
const DAY_MS = 86400000;

// Apprentissage intensif : une session parcourt les cartes pas encore sues par
// cœur, ordonnées des moins maîtrisées (au début) aux mieux connues (fin). Quand
// on note une carte, on la réinjecte plus loin dans la file selon la note :
// « Pas » revient très vite, « Bof » un peu plus loin, « Bien » repart en fin de
// file (bien connue mais pas encore acquise). Seule « ★ Par cœur » fait sortir la
// carte de la file. Décalages = nombre de cartes avant la prochaine réapparition
// (Infinity = renvoyée en fin de file).
const REQUEUE_OFFSET = { pas: 2, bof: 8, bien: Infinity };

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

// Une carte est « sue par cœur » uniquement quand sa dernière note est « ★ Par cœur ».
// « Bien » signale une carte bien connue mais pas encore acquise : elle continue de
// tourner (repoussée en fin de file) jusqu'à ce qu'on la passe « Par cœur ».
function isMastered(card) {
  return !!card && card.lastGrade === "sur";
}

// Nombre de cartes du deck actuellement sues par cœur. Dérivé de l'état persistant
// (state.cards) : la valeur est donc stable d'une session à l'autre et survit à un
// rechargement de page — l'accueil et le compteur en cours de session l'utilisent.
function masteredCount() {
  return Object.keys(state.cards).filter((c) => BY_CODE[c] && isMastered(state.cards[c])).length;
}

function renderDeckHome() {
  const codes = Object.keys(state.cards).filter((c) => BY_CODE[c]);
  const total = codes.length;
  const fresh = codes.filter((c) => (state.cards[c].reps || 0) === 0).length;
  const mastered = masteredCount();
  const pending = total - mastered; // cartes pas encore sues par cœur

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
    `<div class="stat"><span class="stat-num">${fresh}</span><span class="stat-lbl">jamais vues</span></div>` +
    `<div class="stat"><span class="stat-num">${mastered}</span><span class="stat-lbl">sues par cœur</span></div>` +
    "</div>" +
    `<button class="btn btn-primary" id="d-start" type="button"${pending === 0 ? " disabled" : ""}>` +
    (total === 0
      ? "Deck vide"
      : pending === 0
        ? "Tout est su par cœur 🎉"
        : `Réviser (${pending} en attente)`) +
    "</button>" +
    '<p class="muted next-step">Les cartes pas encore acquises défilent, les moins ' +
    "maîtrisées d'abord. Tu révèles la réponse, puis tu t'auto-évalues : " +
    "<b>Pas</b> (revient tout de suite) / <b>Bof</b> (revient bientôt) / " +
    "<b>Bien</b> (repart en fin de file) / <b>★ Par cœur</b> (acquise : sort du " +
    "deck et revient très espacée). On boucle jusqu'à ce que chaque carte " +
    "passe en « ★ Par cœur ».</p>" +
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

// « Force » d'une carte : plus c'est élevé, mieux elle est connue. Dérivée des
// champs SRS déjà présents dans l'état (rétro-compatible avec les sauvegardes v1).
function strength(card) {
  if (!card || (card.reps || 0) === 0) return 0; // jamais vue → à voir tôt
  let s = (card.intervalDays || 0) + (card.reps || 0) * 0.5 - (card.lapses || 0);
  if (card.lastGrade === "pas") s -= 5;
  else if (card.lastGrade === "bof") s -= 1;
  else if (card.lastGrade === "bien") s += 2;
  return s;
}

// Niveau de confiance affiché sur la carte (« est-ce que je connais celle-ci ? »),
// dérivé de l'historique SRS déjà stocké — aucun champ supplémentaire.
//  Nouvelle → Fragile (dernier « Pas ») → À consolider (« Bof ») →
//  Bien sue (dernier « Bien ») → Sue par cœur (dernier « ★ Par cœur »).
// La pastille ★ suit la même définition que le compteur « sues » (note « Par cœur »).
function masteryLevel(card) {
  const reps = (card && card.reps) || 0;
  const last = card && card.lastGrade;
  if (reps === 0) return { label: "Nouvelle", cls: "m-new", icon: "•" };
  if (last === "pas") return { label: "Fragile", cls: "m-weak", icon: "✕" };
  if (last === "bof") return { label: "À consolider", cls: "m-mid", icon: "~" };
  if (last === "sur") return { label: "Sue par cœur", cls: "m-top", icon: "★" };
  return { label: "Bien sue", cls: "m-good", icon: "✓" };
}

// Détail au survol de la pastille (historique de la carte).
function masteryTitle(card) {
  const reps = (card && card.reps) || 0;
  if (reps === 0) return "Jamais révisée";
  const labels = { pas: "Pas", bof: "Bof", bien: "Bien", sur: "Par cœur" };
  const parts = [`${reps} révision${reps > 1 ? "s" : ""}`];
  const lapses = (card && card.lapses) || 0;
  if (lapses > 0) parts.push(`${lapses} oubli${lapses > 1 ? "s" : ""}`);
  if (card && labels[card.lastGrade]) parts.push(`dernière : ${labels[card.lastGrade]}`);
  return parts.join(" · ");
}

// Tout le deck, ordonné des cartes les moins maîtrisées (début) aux mieux
// connues (fin). Léger aléa pour varier l'ordre à force égale entre deux passages.
function orderedDeck() {
  return Object.keys(state.cards)
    .filter((c) => BY_CODE[c])
    .map((c) => ({ c, s: strength(state.cards[c]), r: Math.random() }))
    .sort((a, b) => a.s - b.s || a.r - b.r)
    .map((x) => x.c);
}

function startSession() {
  // On ne révise que les cartes pas encore sues par cœur (les autres sont acquises).
  const queue = orderedDeck().filter((c) => !isMastered(state.cards[c]));
  if (queue.length === 0) {
    renderDeckHome();
    return;
  }
  session = {
    queue,
    grades: { pas: 0, bof: 0, bien: 0, sur: 0 },
    reviewed: 0,
    // « sues » se compte sur le deck entier → total = taille du deck (pas de la file).
    total: Object.keys(state.cards).filter((c) => BY_CODE[c]).length,
  };
  renderCard();
}

// Algorithme SRS simplifié : calcule le nouvel état d'une carte selon la note.
//  - Pas      : échec, revient dans la même session (~1 min), ease abaissé, lapse.
//  - Bof      : réussite difficile, intervalle qui croît lentement, ease abaissé.
//  - Bien     : réussite, intervalle multiplié par l'ease.
//  - Par cœur : réussite franche, gros bond d'intervalle (bonus « facile »).
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
  } else if (grade === "sur") {
    ease = Math.min(3.0, ease + 0.05);
    intervalDays = intervalDays < 1 ? 4 : Math.max(4, Math.round(intervalDays * ease * 1.3));
  } else {
    intervalDays = intervalDays < 1 ? 1 : Math.max(1, Math.round(intervalDays * ease));
  }
  return { ...card, ease, reps, lapses, intervalDays, lastGrade: grade, due: now + intervalDays * DAY_MS };
}

// Aperçu de la prochaine réapparition dans ce passage, sur les boutons.
function previewLabel(grade) {
  if (grade === "pas") return "tout de suite";
  if (grade === "bof") return "bientôt";
  if (grade === "sur") return "acquise";
  return "fin du deck";
}

function renderCard() {
  if (!session || session.queue.length === 0) {
    endSession();
    return;
  }
  const code = session.queue[0];
  const q = BY_CODE[code];
  const card = state.cards[code];
  const m = masteryLevel(card);
  const masteryBadge =
    `<span class="mastery-badge ${m.cls}" title="${escapeHtml(masteryTitle(card))}">` +
    `${m.icon} ${m.label}</span>`;

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
    `<span class="review-progress">${session.queue.length} en attente · ${masteredCount()}/${session.total} sues</span>` +
    "</div>" +
    `<p class="code-line">${masteryBadge}<span class="code">${escapeHtml(code)}</span>` +
    q.categories.map((c) => `<span class="tag cat">${escapeHtml(c)}</span>`).join("") +
    "</p>" +
    `<p class="qtext">${escapeHtml(q.question)}</p>` +
    `<ul class="answers ans-review" id="r-answers">${answers}</ul>` +
    explanation +
    '<div class="review-actions" id="r-reveal-wrap">' +
    '<button class="btn btn-primary" id="r-reveal" type="button">Afficher la réponse <small>(Espace)</small></button>' +
    "</div>" +
    '<div class="grade-buttons" id="r-grades" hidden>' +
    `<button class="btn grade-pas" data-g="pas" type="button">Pas<small>${previewLabel("pas")}</small></button>` +
    `<button class="btn grade-bof" data-g="bof" type="button">Bof<small>${previewLabel("bof")}</small></button>` +
    `<button class="btn grade-bien" data-g="bien" type="button">Bien<small>${previewLabel("bien")}</small></button>` +
    `<button class="btn grade-sur" data-g="sur" type="button">★ Par cœur<small>${previewLabel("sur")}</small></button>` +
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
  state.cards[code] = schedule(state.cards[code], grade); // progression long terme
  session.grades[grade] = (session.grades[grade] || 0) + 1;
  session.reviewed += 1;
  saveState();
  // Réinjection intensive dans le tour en cours :
  //  - « ★ Par cœur » : carte acquise, elle sort de la file (donc du décompte
  //    « en attente », et « sues » est déjà incrémenté plus haut via saveState) ;
  //  - « Pas »/« Bof » : remise quelques cartes plus loin pour repasser vite ;
  //  - « Bien » : connue mais pas acquise, repart en fin de file (offset Infinity).
  if (grade !== "sur") {
    const offset = REQUEUE_OFFSET[grade] || 4;
    session.queue.splice(Math.min(offset, session.queue.length), 0, code);
  }
  renderCard();
}

function endSession() {
  const g = session ? session.grades : { pas: 0, bof: 0, bien: 0, sur: 0 };
  const reviewed = session ? session.reviewed : 0;
  const remaining = session ? session.queue.length : 0;
  const completed = remaining === 0; // file vide = toutes les cartes sont passées « Par cœur »
  session = null;
  app.innerHTML =
    '<div class="card review-done">' +
    (completed ? "<h2>Tout est su par cœur 🎉</h2>" : "<h2>Passage en pause ⏸️</h2>") +
    `<p class="muted">${reviewed} révision${reviewed > 1 ? "s" : ""} effectuée${reviewed > 1 ? "s" : ""}` +
    (remaining > 0
      ? `, ${remaining} carte${remaining > 1 ? "s" : ""} encore en attente.`
      : ".") +
    "</p>" +
    '<div class="stats">' +
    `<div class="stat"><span class="stat-num">${g.sur}</span><span class="stat-lbl">★ Par cœur</span></div>` +
    `<div class="stat"><span class="stat-num">${g.bien}</span><span class="stat-lbl">Bien</span></div>` +
    `<div class="stat"><span class="stat-num">${g.bof}</span><span class="stat-lbl">Bof</span></div>` +
    `<div class="stat"><span class="stat-num">${g.pas}</span><span class="stat-lbl">Pas</span></div>` +
    "</div>" +
    (completed
      ? '<button class="btn btn-primary" id="s-home" type="button">Retour au deck</button>'
      : '<button class="btn btn-primary" id="s-again" type="button">Continuer le deck</button>' +
        '<div class="deck-actions"><button class="btn" id="s-home" type="button">Retour au deck</button></div>') +
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
    } else if (e.key === "4") {
      e.preventDefault();
      gradeCard("sur");
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
