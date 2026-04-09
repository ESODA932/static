// gameImages.js — Static (formerly Pixel Reveal)
//
// CURSOR INSTRUCTIONS:
// Images are now stored in Supabase, not fetched from Wikipedia.
// - To add images: insert rows into the `questions` table in Supabase (see README).
// - To add a category: add rows with a new category string and update the
//   category buttons in index.html to match.
// - Do NOT re-add Wikipedia API fetching. All image URLs come from Supabase.
// - loadGameImages() fetches all rows once on game start and returns them.
//   Do not call it per-round.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

/**
 * Fetches all questions from Supabase and returns them in game-ready format.
 * Each row in the `questions` table must have:
 *   id, category, answer, alt_answers (json array), image_url
 */
export async function loadGameImages() {
  const endpoint =
    `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/questions` +
    `?select=category,answer,alt_answers,image_url&order=id.asc`;

  const res = await fetch(endpoint, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to load questions: HTTP ${res.status} ${text}`);
  }

  const rows = await res.json();

  return rows.map((row) => ({
    category: row.category,
    answer: row.answer,
    altAnswers: row.alt_answers ?? [],
    imageUrl: row.image_url,
  }));
}

/**
 * Checks if a player's guess matches an entry.
 * Case-insensitive, trims whitespace, strips punctuation.
 */
export function checkAnswer(entry, playerInput) {
  const normalize = (s) =>
    String(s ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, "");
  const accepted = [entry.answer, ...(entry.altAnswers || [])].map(normalize);
  return accepted.includes(normalize(playerInput));
}

/**
 * Calculates score based on how quickly the player guessed.
 * 1000 pts at t=0, scales down to 50 pts at t=15s.
 */
export function calcScore(elapsedSeconds) {
  return Math.max(50, Math.round(1000 - (elapsedSeconds / 15) * 950));
}
