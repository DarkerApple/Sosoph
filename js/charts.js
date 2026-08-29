// Custom charts made in the editor. One chart per song, stored as plain note
// records so a chart survives changes to the generator.

import { load, save, remove } from './storage.js';

const KEY = 'charts.v1';

export const allCharts = () => load(KEY, {});

export function getChart(songId) {
  const chart = allCharts()[songId];
  return chart && Array.isArray(chart.notes) ? chart : null;
}

export function putChart(songId, notes) {
  const all = allCharts();
  all[songId] = {
    notes: notes.map((n) => ({
      t: +n.t.toFixed(4),
      lane: n.lane,
      dur: +(n.dur || 0).toFixed(4),
      color: n.color || 0,
    })),
    updated: Date.now(),
  };
  return save(KEY, all);
}

export function deleteChart(songId) {
  const all = allCharts();
  delete all[songId];
  if (Object.keys(all).length) save(KEY, all);
  else remove(KEY);
}
