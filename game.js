/**
 * Pixel Reveal — progressive clarity + guess scoring
 */

import {
  loadGameImages,
  checkAnswer as checkEntryAnswer,
  calcScore,
} from "./gameImages.js";

const ROUND_MS = 15000;
const ROUNDS_TOTAL = 5;
const LOCAL_KEY = "pixelRevealHighScores";
const RULES_SEEN_KEY = "pixelRevealRulesSeen";
const LEADERBOARD_TABLE = "leaderboard";

/**
 * Image entries loaded from gameImages.js (Wikipedia-backed thumbnails).
 * Categories: TV, GAMES, SPORTS.
 */
let IMAGE_ENTRIES = [];
let POOLS = { tv: [], games: [], sports: [] };

let supabaseConfig = { url: "", anonKey: "" };

try {
  const mod = await import("./config.js");
  supabaseConfig = {
    url: mod.SUPABASE_URL || "",
    anonKey: mod.SUPABASE_ANON_KEY || "",
  };
} catch {
  /* config.js optional */
}

const els = {
  categoryPanel: document.getElementById("categoryPanel"),
  gamePanel: document.getElementById("gamePanel"),
  inputPanel: document.getElementById("inputPanel"),
  categoryStat: document.getElementById("categoryStat"),
  categoryDisplay: document.getElementById("categoryDisplay"),
  roundDisplay: document.getElementById("roundDisplay"),
  scoreDisplay: document.getElementById("scoreDisplay"),
  gameImage: document.getElementById("gameImage"),
  pixelCanvas: document.getElementById("pixelCanvas"),
  timerBar: document.getElementById("timerBar"),
  guessInput: document.getElementById("guessInput"),
  submitBtn: document.getElementById("submitBtn"),
  skipBtn: document.getElementById("skipBtn"),
  feedback: document.getElementById("feedback"),
  localScores: document.getElementById("localScores"),
  globalScores: document.getElementById("globalScores"),
  globalLoading: document.getElementById("globalLoading"),
  globalError: document.getElementById("globalError"),
  globalHint: document.getElementById("globalHint"),
  nameModal: document.getElementById("nameModal"),
  finalScore: document.getElementById("finalScore"),
  playerName: document.getElementById("playerName"),
  saveScoreBtn: document.getElementById("saveScoreBtn"),
  skipSaveBtn: document.getElementById("skipSaveBtn"),
  rulesModal: document.getElementById("rulesModal"),
  rulesBtn: document.getElementById("rulesBtn"),
  rulesDismissBtn: document.getElementById("rulesDismissBtn"),
};

const ctx = els.pixelCanvas.getContext("2d", { willReadFrequently: true });
ctx.imageSmoothingEnabled = false;

let roundIndex = 0;
let totalScore = 0;
let roundStart = 0;
let rafId = 0;
let currentRound = null;
let imageBitmap = null;
let gameOver = false;
let rounds = [];
let imagesLoaded = false;
let imageLoadError = null;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRounds(categoryKey) {
  const pool = POOLS[categoryKey] || [];
  if (!pool || pool.length === 0) return [];
  return shuffle(pool).slice(0, ROUNDS_TOTAL);
}

function categoryLabel(key) {
  if (key === "tv") return "TV";
  if (key === "games") return "GAMES";
  if (key === "sports") return "SPORTS";
  return "—";
}

function formatReveal(round) {
  if (!round) return "";
  const label = round.label || (round.answers && round.answers[0]) || "?";
  return ` Answer: ${label}`;
}

function resizeCanvasToFrame() {
  const frame = els.pixelCanvas.parentElement;
  const w = frame.clientWidth;
  const h = frame.clientHeight;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  els.pixelCanvas.width = Math.floor(w * dpr);
  els.pixelCanvas.height = Math.floor(h * dpr);
  els.pixelCanvas.style.width = `${w}px`;
  els.pixelCanvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
}

// Offscreen noise canvas — regenerated periodically for performance
let _noiseCanvas = null;
let _noiseFrame = 0;

function getNoiseCanvas(cw, ch) {
  // Regenerate noise every 2 frames to save CPU while keeping flicker alive
  _noiseFrame++;
  if (!_noiseCanvas || _noiseCanvas.width !== cw || _noiseCanvas.height !== ch || _noiseFrame % 2 === 0) {
    if (!_noiseCanvas) {
      _noiseCanvas = document.createElement("canvas");
    }
    _noiseCanvas.width = cw;
    _noiseCanvas.height = ch;
    const nctx = _noiseCanvas.getContext("2d");
    const imageData = nctx.createImageData(cw, ch);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const v = Math.random() * 255;
      data[i]     = v * (0.6 + Math.random() * 0.8); // R — slightly varied for color
      data[i + 1] = v * (0.6 + Math.random() * 0.8); // G
      data[i + 2] = v * (0.6 + Math.random() * 0.8); // B
      data[i + 3] = 255;
    }
    nctx.putImageData(imageData, 0, 0);
  }
  return _noiseCanvas;
}

function drawPixelated(progress) {
  if (!imageBitmap) return;
  const cw = els.pixelCanvas.clientWidth || 320;
  const ch = els.pixelCanvas.clientHeight || 240;
  const iw = imageBitmap.width;
  const ih = imageBitmap.height;
  const scale = Math.min(cw / iw, ch / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const ox = (cw - dw) / 2;
  const oy = (ch - dh) / 2;

  // ── 1. Pixelation: starts very blocky, sharpens as signal comes in ──
  // Slow easing early so it stays unrecognisable, then clears fast at the end
  const startBlocks = 12;
  const pEff = Math.pow(progress, 1.8);
  const blockSize = Math.max(1, Math.round(startBlocks * (1 - pEff) + 1 * pEff));
  const smallW = Math.max(1, Math.ceil(dw / blockSize));
  const smallH = Math.max(1, Math.ceil(dh / blockSize));

  // Draw pixelated image to main canvas
  const off = document.createElement("canvas");
  off.width = smallW;
  off.height = smallH;
  const octx = off.getContext("2d");
  octx.imageSmoothingEnabled = false;
  octx.drawImage(imageBitmap, 0, 0, iw, ih, 0, 0, smallW, smallH);

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, 0, 0, smallW, smallH, ox, oy, dw, dh);

  // ── 2. Static overlay: full strength early, fades away as signal locks in ──
  // Static opacity goes from 0.92 → 0 using its own faster easing
  const staticEff = Math.pow(progress, 1.4);
  const staticAlpha = Math.max(0, 0.92 * (1 - staticEff));

  if (staticAlpha > 0.01) {
    const noiseCanvas = getNoiseCanvas(cw, ch);
    ctx.globalAlpha = staticAlpha;
    ctx.drawImage(noiseCanvas, 0, 0);
    ctx.globalAlpha = 1.0;
  }
}

function tick() {
  if (gameOver || !currentRound) return;
  const elapsed = performance.now() - roundStart;
  const p = Math.min(1, elapsed / ROUND_MS);
  drawPixelated(p);

  const remaining = 1 - p;
  els.timerBar.style.transform = `scaleX(${remaining})`;

  if (p >= 1) {
    const reveal = formatReveal(currentRound);
    endRound(false, `Time's up — no points.${reveal}`);
    return;
  }
  rafId = requestAnimationFrame(tick);
}

function stopRoundLoop() {
  cancelAnimationFrame(rafId);
}

async function loadImageData(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image failed to load"));
    img.src = url;
  });
}

async function startRound() {
  if (roundIndex >= ROUNDS_TOTAL) {
    finishGame();
    return;
  }
  currentRound = rounds[roundIndex];
  els.roundDisplay.textContent = String(roundIndex + 1);
  els.feedback.textContent = "";
  els.feedback.className = "feedback";
  els.guessInput.value = "";
  els.guessInput.focus();

  roundStart = performance.now();
  resizeCanvasToFrame();

  try {
    const imgUrl = currentRound.url;
    if (!imgUrl) {
      throw new Error("No image URL resolved");
    }
    const img = await loadImageData(imgUrl);
    els.gameImage.src = imgUrl;
    imageBitmap = img;
    drawPixelated(0);
  } catch {
    els.feedback.textContent = "Could not load image — skipping.";
    els.feedback.classList.add("bad");
    setTimeout(() => {
      roundIndex++;
      startRound();
    }, 1200);
    return;
  }

  rafId = requestAnimationFrame(tick);
}

function endRound(correct, message) {
  stopRoundLoop();
  els.feedback.textContent = message;
  els.feedback.className = "feedback " + (correct ? "ok" : "bad");

  roundIndex++;
  setTimeout(() => {
    if (roundIndex >= ROUNDS_TOTAL) finishGame();
    else startRound();
  }, correct ? 1400 : 2200);
}

function submitGuess() {
  if (gameOver || !currentRound) return;
  const guess = els.guessInput.value;
  const elapsed = performance.now() - roundStart;
  if (elapsed >= ROUND_MS) return;

  if (checkEntryAnswer(currentRound.entry, guess)) {
    const pts = calcScore(elapsed / 1000);
    totalScore += pts;
    els.scoreDisplay.textContent = String(totalScore);
    stopRoundLoop();
    endRound(true, `Correct! +${pts} pts (${(elapsed / 1000).toFixed(1)}s)`);
  } else {
    els.feedback.textContent = "Not quite — try again!";
    els.feedback.className = "feedback bad";
  }
}

function passRound() {
  if (gameOver || !currentRound) return;
  stopRoundLoop();
  const reveal = formatReveal(currentRound);
  endRound(false, `Passed — 0 pts.${reveal}`);
}

function finishGame() {
  gameOver = true;
  stopRoundLoop();
  els.finalScore.textContent = String(totalScore);
  els.nameModal.classList.remove("hidden");
  els.playerName.value = `PLAYER${Math.floor(Math.random() * 900 + 100)}`;
}

function readLocalScores() {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function writeLocalScores(entries) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(entries.slice(0, 20)));
}

function renderLocalScores() {
  const list = readLocalScores();
  els.localScores.innerHTML = "";
  if (list.length === 0) {
    els.localScores.innerHTML = "<li class='muted'>No runs yet</li>";
    return;
  }
  list.forEach((e) => {
    const li = document.createElement("li");
    li.textContent = `${e.name} — ${e.score} pts`;
    els.localScores.appendChild(li);
  });
}

async function fetchGlobalLeaderboard() {
  const { url, anonKey } = supabaseConfig;
  if (!url || !anonKey) {
    els.globalLoading.classList.add("hidden");
    els.globalHint.classList.remove("hidden");
    return;
  }

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${LEADERBOARD_TABLE}?select=name,score,created_at&order=score.desc&limit=10`;
  try {
    const res = await fetch(endpoint, {
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`HTTP ${res.status} ${errText}`);
    }
    const rows = await res.json();
    els.globalLoading.classList.add("hidden");
    els.globalError.classList.add("hidden");
    els.globalScores.classList.remove("hidden");
    els.globalHint.classList.add("hidden");
    els.globalScores.innerHTML = "";
    rows.forEach((r, i) => {
      const li = document.createElement("li");
      li.textContent = `${i + 1}. ${r.name} — ${r.score} pts`;
      els.globalScores.appendChild(li);
    });
  } catch (e) {
    els.globalLoading.classList.add("hidden");
    els.globalScores.classList.add("hidden");
    els.globalError.classList.remove("hidden");
    const msg = String(e && e.message ? e.message : e);
    if (msg.includes("HTTP 404")) {
      els.globalError.textContent =
        "Global leaderboard table not found. Run supabase/setup.sql in Supabase SQL Editor.";
      return;
    }
    if (msg.includes("HTTP 401") || msg.includes("HTTP 403")) {
      els.globalError.textContent =
        "Supabase key rejected. Use project URL + publishable/anon key in config.js.";
      return;
    }
    els.globalError.textContent = "Could not load global leaderboard. Check Supabase setup and RLS policies.";
  }
}

async function submitGlobalScore(name, score) {
  const { url, anonKey } = supabaseConfig;
  if (!url || !anonKey) return;

  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/${LEADERBOARD_TABLE}`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ name: name.slice(0, 16), score }),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Global submit failed: HTTP ${res.status} ${errText}`);
  }
}

function saveLocalScore(name, score) {
  const entries = readLocalScores();
  entries.push({ name, score, at: Date.now() });
  entries.sort((a, b) => b.score - a.score);
  writeLocalScores(entries);
  renderLocalScores();
}

function showCategoryPicker() {
  els.categoryPanel.classList.remove("hidden");
  els.gamePanel.classList.add("hidden");
  els.inputPanel.classList.add("hidden");
  els.categoryStat.classList.add("hidden");
  els.roundDisplay.textContent = "—";
}

function openRulesModal() {
  els.rulesModal.classList.remove("hidden");
  requestAnimationFrame(() => els.rulesDismissBtn.focus());
}

function dismissRulesModal() {
  els.rulesModal.classList.add("hidden");
  localStorage.setItem(RULES_SEEN_KEY, "1");
}

function beginCategory(cat) {
  if (!imagesLoaded || imageLoadError) {
    els.feedback.textContent =
      "Images are still loading or failed to load. Try again in a moment.";
    els.feedback.className = "feedback bad";
    return;
  }

  const key = cat.toLowerCase();
  const pool = POOLS[key] || [];
  if (!pool.length) {
    els.feedback.textContent = "No images available for this category yet.";
    els.feedback.className = "feedback bad";
    return;
  }

  rounds = pickRounds(key);
  els.categoryDisplay.textContent = categoryLabel(cat);
  els.categoryStat.classList.remove("hidden");
  els.categoryPanel.classList.add("hidden");
  els.gamePanel.classList.remove("hidden");
  els.inputPanel.classList.remove("hidden");
  gameOver = false;
  roundIndex = 0;
  totalScore = 0;
  els.scoreDisplay.textContent = "0";
  els.feedback.textContent = "";
  els.feedback.className = "feedback";
  startRound();
}

function resetGame() {
  gameOver = false;
  roundIndex = 0;
  totalScore = 0;
  currentRound = null;
  imageBitmap = null;
  els.scoreDisplay.textContent = "0";
  els.nameModal.classList.add("hidden");
  showCategoryPicker();
}

document.querySelectorAll(".category-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const cat = btn.getAttribute("data-category");
    if (cat) beginCategory(cat);
  });
});

els.rulesBtn.addEventListener("click", openRulesModal);
els.rulesDismissBtn.addEventListener("click", dismissRulesModal);
els.rulesModal.addEventListener("click", (e) => {
  if (e.target === els.rulesModal) dismissRulesModal();
});

window.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!els.rulesModal.classList.contains("hidden")) {
    e.preventDefault();
    dismissRulesModal();
  }
});

els.submitBtn.addEventListener("click", submitGuess);
els.guessInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    submitGuess();
  }
});
els.skipBtn.addEventListener("click", passRound);

els.saveScoreBtn.addEventListener("click", async () => {
  const name = (els.playerName.value || "ANON").trim().slice(0, 16) || "ANON";
  const score = totalScore;
  saveLocalScore(name, score);
  try {
    await submitGlobalScore(name, score);
  } catch {
    /* optional */
  }
  await fetchGlobalLeaderboard();
  els.nameModal.classList.add("hidden");
  resetGame();
});

els.skipSaveBtn.addEventListener("click", () => {
  els.nameModal.classList.add("hidden");
  resetGame();
});

window.addEventListener("resize", () => {
  if (!gameOver && currentRound && imageBitmap) {
    resizeCanvasToFrame();
    const elapsed = performance.now() - roundStart;
    const p = Math.min(1, elapsed / ROUND_MS);
    drawPixelated(p);
  }
});

async function initImages() {
  try {
    IMAGE_ENTRIES = await loadGameImages();
    const byCat = { tv: [], games: [], sports: [] };
    IMAGE_ENTRIES.forEach((entry) => {
      const key = entry.category.toLowerCase();
      if (!byCat[key]) return;
      if (!entry.imageUrl) return;
      byCat[key].push({
        label: entry.answer,
        url: entry.imageUrl,
        entry,
      });
    });
    POOLS = byCat;
    imagesLoaded = true;
  } catch (e) {
    imageLoadError = e;
  }
}

await initImages();

renderLocalScores();
fetchGlobalLeaderboard();
showCategoryPicker();

if (!localStorage.getItem(RULES_SEEN_KEY)) {
  openRulesModal();
}
