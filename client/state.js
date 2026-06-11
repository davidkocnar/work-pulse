import { loadTempo, loadFavorites } from './storage.js';

export const state = {
  // Active month being viewed.
  year: new Date().getFullYear(),
  month: new Date().getMonth() + 1,
  // Selected day (YYYY-MM-DD) or null.
  selected: null,
  // Last fetched payload.
  events: { github: [], slack: [], calendar: [], email: [] },
  // Per-day index built from events: { 'YYYY-MM-DD': { gh: n, sl: n } }
  dayIndex: {},
  // Mappings list.
  mappings: [],
  // Health/config.
  health: { config: {} },
  // Tempo logs persisted by date in localStorage.
  tempoByDay: loadTempo(),
  // Real worklogs fetched from Tempo for the active month.
  worklogs: [],
  // Favorite tasks (persisted in localStorage).
  favorites: loadFavorites(),
  loading: false,
};
