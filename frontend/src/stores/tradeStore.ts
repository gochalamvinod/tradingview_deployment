import { create } from 'zustand';
import type { Position, Order, AccountInfo, MarketOrderRequest, CloseOrderRequest, TradeResponse } from '../types/trade';
import { api } from '../services/api';

interface TradeState {
  positions: Position[];
  orders: Order[];
  account: AccountInfo | null;
  executions: any[];
  isLoading: boolean;
  error: string | null;
  
  fetchPositions: () => Promise<void>;
  fetchOrders: () => Promise<void>;
  fetchAccount: () => Promise<void>;
  placeMarketOrder: (req: MarketOrderRequest) => Promise<TradeResponse>;
  closePosition: (req: CloseOrderRequest) => Promise<TradeResponse>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
}

export const useTradeStore = create<TradeState>((set, get) => {
  let pollInterval: number | null = null;

  return {
    positions: [],
    orders: [],
    account: null,
    executions: [],
    isLoading: false,
    error: null,

    fetchPositions: async () => {
      try {
        const positions = await api.getPositions();
        set({ positions });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    fetchOrders: async () => {
      try {
        const orders = await api.getOrders();
        set({ orders });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    fetchAccount: async () => {
      try {
        const account = await api.getAccount();
        set({ account });
      } catch (err: any) {
        set({ error: err.message });
      }
    },

    placeMarketOrder: async (req: MarketOrderRequest) => {
      set({ isLoading: true, error: null });
      try {
        const res = await api.placeOrder(req);
        if (res.success) {
          await get().fetchPositions();
          await get().fetchAccount();
        } else {
          set({ error: res.retcode_description || res.error });
        }
        return res;
      } catch (err: any) {
        set({ error: err.message });
        throw err;
      } finally {
        set({ isLoading: false });
      }
    },

    closePosition: async (req: CloseOrderRequest) => {
      set({ isLoading: true, error: null });
      try {
        const res = await api.closePosition(req);
        if (res.success) {
          await get().fetchPositions();
          await get().fetchAccount();
        } else {
          set({ error: res.retcode_description || res.error });
        }
        return res;
      } catch (err: any) {
        set({ error: err.message });
        throw err;
      } finally {
        set({ isLoading: false });
      }
    },

    startPolling: (intervalMs = 5000) => {
      if (pollInterval) return;
      
      const poll = async () => {
        await Promise.all([
          get().fetchPositions(),
          get().fetchOrders(),
          get().fetchAccount()
        ]);
      };
      
      poll();
      pollInterval = window.setInterval(poll, intervalMs);
    },

    stopPolling: () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    }
  };
});
