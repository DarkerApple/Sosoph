// Filtering, sorting and grouping for the song list.
//
// Pure functions over the catalogue, kept out of `main.js` so the list's
// behaviour can be reasoned about (and tested) without a DOM.

import { DIFFICULTIES } from './theme.js';

export const DEFAULT_VIEW = {
  q: '',
  genre: 'all',
  difficulty: 'any',
  status: 'all',
  sort: 'default',
  /** 1 ascending, -1 descending. */
  dir: 1,
  group: false,
};

export const SORTS = [
  { id: 'default', label: 'Recommended' },
  { id: 'title', label: 'Title' },
  { id: 'genre', label: 'Genre' },
  { id: 'bpm', label: 'BPM' },
  { id: 'length', label: 'Length' },
  { id: 'level', label: 'Level' },
  { id: 'score', label: 'Best score' },
];

export const STATUSES = [
  { id: 'all', label: 'Any status' },
  { id: 'unplayed', label: 'Unplayed' },
  { id: 'played', label: 'Played' },
  { id: 'fullcombo', label: 'Full combo' },
];

/** Every genre in the catalogue, in alphabetical order. */
export const genresOf = (songs) => [...new Set(songs.map((s) => s.genre))].sort();

const recordsFor = (song, best) =>
  song.difficulties
    .map((d) => best[`${song.id}/${d.id}`])
    .filter(Boolean);

/**
 * The level to judge a song by. With a difficulty filter active that is the
 * level of that tier; otherwise it is the song's hardest chart, which is what
 * people mean when they ask how hard a song is.
 */
export function levelOf(song, view) {
  const picked = song.difficulties.find((d) => d.id === view.difficulty);
  if (picked) return picked.level;
  return song.difficulties.reduce((a, d) => Math.max(a, Number(d.level) || 0), 0);
}

/** Best score across the song, or across the filtered tier when one is set. */
export function scoreOf(song, view, best) {
  if (view.difficulty !== 'any') {
    const rec = best[`${song.id}/${view.difficulty}`];
    return rec ? rec.score : -1;
  }
  const recs = recordsFor(song, best);
  return recs.length ? Math.max(...recs.map((r) => r.score)) : -1;
}

export function filterSongs(songs, view, best) {
  const q = view.q.trim().toLowerCase();
  return songs.filter((s) => {
    if (q && !`${s.title} ${s.genre} ${s.artist}`.toLowerCase().includes(q)) return false;
    if (view.genre !== 'all' && s.genre !== view.genre) return false;
    if (view.difficulty !== 'any' && !s.difficulties.some((d) => d.id === view.difficulty)) return false;

    if (view.status !== 'all') {
      const recs = view.difficulty !== 'any'
        ? [best[`${s.id}/${view.difficulty}`]].filter(Boolean)
        : recordsFor(s, best);
      if (view.status === 'unplayed' && recs.length) return false;
      if (view.status === 'played' && !recs.length) return false;
      if (view.status === 'fullcombo' && !recs.some((r) => r.fc)) return false;
    }
    return true;
  });
}

export function sortSongs(songs, view, best) {
  const order = new Map(songs.map((s, i) => [s.id, i]));
  const key = {
    default: (s) => order.get(s.id),
    title: (s) => s.title.toLowerCase(),
    genre: (s) => `${s.genre.toLowerCase()} ${s.title.toLowerCase()}`,
    bpm: (s) => s.bpm,
    length: (s) => s.duration,
    level: (s) => levelOf(s, view),
    score: (s) => scoreOf(s, view, best),
  }[view.sort] || ((s) => order.get(s.id));

  return [...songs].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka < kb) return -view.dir;
    if (ka > kb) return view.dir;
    // A stable secondary key keeps equal rows from shuffling between renders.
    return order.get(a.id) - order.get(b.id);
  });
}

/** Level bands, used as headings when grouping is on. */
const BANDS = [
  { max: 9, label: 'Level 1–9' },
  { max: 19, label: 'Level 10–19' },
  { max: 29, label: 'Level 20–29' },
  { max: Infinity, label: 'Level 30+' },
];

/**
 * Split into labelled sections. Grouping is by level band rather than by genre:
 * with a genre per song a genre heading would just repeat the row under it,
 * while a band tells you at a glance where the step up in difficulty is.
 */
export function groupSongs(songs, view) {
  if (!view.group) return [{ title: null, songs }];
  const groups = new Map();
  for (const s of songs) {
    const band = BANDS.find((b) => levelOf(s, view) <= b.max);
    if (!groups.has(band.label)) groups.set(band.label, []);
    groups.get(band.label).push(s);
  }
  // Keep the bands in difficulty order however the list was sorted.
  return BANDS.filter((b) => groups.has(b.label))
    .map((b) => ({ title: b.label, songs: groups.get(b.label) }));
}

/** Everything the list needs, in one call. */
export function buildList(songs, view, best) {
  const filtered = filterSongs(songs, view, best);
  return {
    total: songs.length,
    shown: filtered.length,
    groups: groupSongs(sortSongs(filtered, view, best), view),
  };
}

/** Difficulty options for the filter, limited to tiers the library actually has. */
export function difficultyOptions(songs) {
  const present = new Set(songs.flatMap((s) => s.difficulties.map((d) => d.id)));
  return DIFFICULTIES.filter((d) => present.has(d.id));
}
