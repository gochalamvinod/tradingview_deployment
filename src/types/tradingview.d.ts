export interface WidgetOptions {
  container: HTMLElement | string;
  datafeed: any;
  library_path: string;
  locale: string;
  symbol: string;
  interval: string;
  timezone?: string;
  theme: 'Dark' | 'Light';
  autosize: boolean;
  fullscreen: boolean;
  debug?: boolean;
  enabled_features: string[];
  disabled_features: string[];
  overrides: Record<string, any>;
  studies_overrides?: Record<string, any>;
  favorites: { intervals: string[]; chartTypes: string[] };
  save_load_adapter?: any;
  loading_screen?: { backgroundColor: string; foregroundColor: string };
  custom_css_url?: string;
  broker_factory?: (host: any) => any;
  broker_config?: any;
  custom_indicators_getter?: (PineJS: any) => Promise<any[]>;
  time_frames?: Array<{ text: string, resolution: string, description?: string }>;
  widgetbar?: any;
  watchlist?: string[];
  [key: string]: any;
}

export interface ChartWidget {
  symbol(): string;
  resolution(): string;
  onIntervalChanged(): { subscribe: (id: any, callback: Function) => void };
  onSymbolResolved(): { subscribe: (id: any, callback: Function) => void };
  onSymbolChanged?(): { subscribe: (id: any, callback: Function) => void };
  createStudy(name: string, isOverlay?: boolean, lock?: boolean, inputs?: any[], overrides?: any): Promise<string>;
  getAllStudies(): Array<{ id: string; name: string }>;
  removeEntity(id: string): void;
  createMultipointShape(points: any[], options: any): string;
  createShape(point: any, options: any): string;
  removeAllShapes(): void;
  getAllShapes(): any[];
}

declare global {
  namespace TradingView {
    class widget {
      constructor(options: WidgetOptions);
      onChartReady(callback: () => void): void;
      headerReady(): Promise<void>;
      createButton(options: { align: string; useTradingViewStyle?: boolean }): HTMLElement;
      save(callback: (state: object) => void): void;
      load(state: object): void;
      subscribe(event: string, callback: Function): void;
      changeTheme(theme: 'Dark' | 'Light'): void;
      activeChart(): ChartWidget;
      remove(): void;
    }
  }

  class Datafeeds {
    static UDFCompatibleDatafeed: new (url: string, updateFrequency?: number) => any;
  }
}
