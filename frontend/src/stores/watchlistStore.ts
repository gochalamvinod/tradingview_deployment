import { create } from 'zustand';

export const DEFAULT_FUTURES_WATCHLIST = [
  'GCZ6',   // Gold Futures (Z6)
  'SIZ6'    // Silver Futures (Z6)
];

const STORAGE_KEY = 'tv_watchlist_lists';
const ACTIVE_KEY = 'tv_active_watchlist_id';

function loadInitialLists(): Array<{ id: string; name: string; symbols: string[] }> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const warmList = parsed.find(l => l.name === 'POPULAR' || l.id === 'POPULAR' || l.name === 'PRE_WARMING' || l.id === 'PRE_WARMING');
        if (warmList) {
          warmList.id = 'POPULAR';
          warmList.name = 'POPULAR';
          warmList.symbols = Array.isArray(warmList.symbols) && warmList.symbols.length > 0 ? warmList.symbols : DEFAULT_FUTURES_WATCHLIST;
          return [warmList];
        }
      }
    }
  } catch {}
  return [{ id: 'POPULAR', name: 'POPULAR', symbols: DEFAULT_FUTURES_WATCHLIST }];
}

interface WatchlistState {
  lists: Array<{ id: string; name: string; symbols: string[] }>;
  activeListId: string | null;
  
  createList: (name: string) => void;
  deleteList: (id: string) => void;
  addSymbol: (listId: string, symbol: string) => void;
  removeSymbol: (listId: string, symbol: string) => void;
  setActiveList: (id: string) => void;
}

export const useWatchlistStore = create<WatchlistState>((set) => ({
  lists: loadInitialLists(),
  activeListId: localStorage.getItem(ACTIVE_KEY) || 'POPULAR',

  createList: (name) => set(state => {
    const id = Date.now().toString();
    const newLists = [...state.lists, { id, name, symbols: [] }];
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(newLists)); } catch {}
    return { lists: newLists, activeListId: id };
  }),
  deleteList: (id) => set(state => {
    const newLists = state.lists.filter(l => l.id !== id);
    const nextActive = state.activeListId === id ? (newLists[0]?.id || null) : state.activeListId;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLists));
      if (nextActive) localStorage.setItem(ACTIVE_KEY, nextActive);
    } catch {}
    return { lists: newLists, activeListId: nextActive };
  }),
  addSymbol: (listId, symbol) => set(state => {
    const sym = symbol.toUpperCase().trim();
    const newLists = state.lists.map(l => l.id === listId && !l.symbols.includes(sym) ? { ...l, symbols: [...l.symbols, sym] } : l);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLists));
      // Notify backend to initialize database, handshake, and pre-warm
      fetch('/api/watchlist/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym })
      }).catch(() => {});
    } catch {}
    return { lists: newLists };
  }),
  removeSymbol: (listId, symbol) => set(state => {
    const sym = symbol.toUpperCase().trim();
    const newLists = state.lists.map(l => l.id === listId ? { ...l, symbols: l.symbols.filter(s => s !== sym) } : l);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newLists));
      // Notify backend to stop caching while preserving SQLite database on disk
      fetch('/api/watchlist/remove', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbol: sym })
      }).catch(() => {});
    } catch {}
    return { lists: newLists };
  }),
  setActiveList: (id) => {
    try { localStorage.setItem(ACTIVE_KEY, id); } catch {}
    set({ activeListId: id });
  }
}));
