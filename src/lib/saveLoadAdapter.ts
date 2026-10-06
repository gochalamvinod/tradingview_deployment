/**
 * LocalStorage Save/Load Adapter for TradingView Advanced Charts
 * Persists all user drawings, shapes, line tools, layouts, and templates across refreshes.
 */

export const CHART_STATE_KEY = 'tv_active_chart_state';
export const CHARTS_LIST_KEY = 'tv_charts_list';
export const DRAWINGS_PREFIX = 'tv_drawings_';
export const TEMPLATES_LIST_KEY = 'tv_drawing_templates_list';
export const TEMPLATE_PREFIX = 'tv_drawing_tpl_';

export function getSavedChartState(): any | null {
  try {
    const raw = localStorage.getItem(CHART_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Failed to parse saved chart state from localStorage', e);
    return null;
  }
}

export function saveActiveChartState(state: any): void {
  try {
    if (!state) return;
    const str = typeof state === 'string' ? state : JSON.stringify(state);
    localStorage.setItem(CHART_STATE_KEY, str);
    localStorage.setItem('tv_chart_content_default_chart', str);
  } catch (e) {
    console.warn('Failed to write chart state to localStorage', e);
  }
}

export class LocalStorageSaveLoadAdapter {
  getAllCharts(): Promise<any[]> {
    try {
      const list = JSON.parse(localStorage.getItem(CHARTS_LIST_KEY) || '[]');
      if (list.length === 0) {
        const active = localStorage.getItem(CHART_STATE_KEY);
        if (active) {
          return Promise.resolve([{
            id: 'default_chart',
            name: 'Default Layout',
            symbol: localStorage.getItem('tv_last_symbol') || 'GCZ6',
            resolution: localStorage.getItem('tv_last_interval') || '1',
            timestamp: Date.now(),
          }]);
        }
      }
      return Promise.resolve(list);
    } catch {
      return Promise.resolve([]);
    }
  }

  removeChart(id: string): Promise<void> {
    try {
      const list = JSON.parse(localStorage.getItem(CHARTS_LIST_KEY) || '[]').filter((c: any) => c.id !== id);
      localStorage.setItem(CHARTS_LIST_KEY, JSON.stringify(list));
      localStorage.removeItem(`tv_chart_content_${id}`);
    } catch {}
    return Promise.resolve();
  }

  saveChart(chartData: any): Promise<string> {
    try {
      const id = chartData.id || `chart_${Date.now()}`;
      chartData.id = id;
      chartData.timestamp = Date.now();
      const list = JSON.parse(localStorage.getItem(CHARTS_LIST_KEY) || '[]').filter((c: any) => c.id !== id);
      list.unshift({
        id,
        name: chartData.name || 'Default Layout',
        symbol: chartData.symbol,
        resolution: chartData.resolution,
        timestamp: chartData.timestamp,
      });
      localStorage.setItem(CHARTS_LIST_KEY, JSON.stringify(list));
      localStorage.setItem(`tv_chart_content_${id}`, chartData.content);
      localStorage.setItem('tv_last_saved_chart_id', id);
      // Also update the active chart state cache
      try {
        if (typeof chartData.content === 'string') {
          localStorage.setItem(CHART_STATE_KEY, chartData.content);
        }
      } catch {}
      return Promise.resolve(id);
    } catch {
      return Promise.reject(new Error('Failed to save chart to localStorage'));
    }
  }

  getChartContent(id: string): Promise<string> {
    const content = localStorage.getItem(`tv_chart_content_${id}`);
    if (content) return Promise.resolve(content);
    const active = localStorage.getItem(CHART_STATE_KEY);
    if (active) return Promise.resolve(active);
    return Promise.reject(new Error('Chart not found'));
  }

  // Line tools & groups (individual drawing tools persistence)
  saveLineToolsAndGroups(layoutId: string, chartId: string, state: any): Promise<void> {
    try {
      const key = `${DRAWINGS_PREFIX}${layoutId || 'default'}_${chartId || '0'}`;
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
    return Promise.resolve();
  }

  loadLineToolsAndGroups(layoutId: string, chartId: string): Promise<any> {
    try {
      const key = `${DRAWINGS_PREFIX}${layoutId || 'default'}_${chartId || '0'}`;
      const raw = localStorage.getItem(key);
      if (raw) return Promise.resolve(JSON.parse(raw));
    } catch {}
    return Promise.resolve(null);
  }

  // Drawing templates
  getAllStudyTemplates(): Promise<any[]> {
    return Promise.resolve([]);
  }

  removeStudyTemplate(): Promise<void> {
    return Promise.resolve();
  }

  saveStudyTemplate(): Promise<void> {
    return Promise.resolve();
  }

  getStudyTemplateContent(): Promise<string> {
    return Promise.reject(new Error('Template not found'));
  }

  getDrawingTemplates(): Promise<string[]> {
    try {
      return Promise.resolve(JSON.parse(localStorage.getItem(TEMPLATES_LIST_KEY) || '[]'));
    } catch {
      return Promise.resolve([]);
    }
  }

  saveDrawingTemplate(toolName: string, templateName: string, content: string): Promise<void> {
    try {
      localStorage.setItem(`${TEMPLATE_PREFIX}${toolName}_${templateName}`, content);
      const list = JSON.parse(localStorage.getItem(TEMPLATES_LIST_KEY) || '[]');
      if (!list.includes(templateName)) {
        list.push(templateName);
        localStorage.setItem(TEMPLATES_LIST_KEY, JSON.stringify(list));
      }
    } catch {}
    return Promise.resolve();
  }

  loadDrawingTemplate(toolName: string, templateName: string): Promise<string> {
    const c = localStorage.getItem(`${TEMPLATE_PREFIX}${toolName}_${templateName}`);
    return c ? Promise.resolve(c) : Promise.reject(new Error('Template not found'));
  }

  removeDrawingTemplate(toolName: string, templateName: string): Promise<void> {
    localStorage.removeItem(`${TEMPLATE_PREFIX}${toolName}_${templateName}`);
    return Promise.resolve();
  }
}
