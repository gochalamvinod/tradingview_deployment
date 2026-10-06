import React, { useMemo } from 'react';
import { useChartWidget } from './useChartWidget';
import { useThemeStore } from '../../stores/themeStore';
import { ReplayToolbar } from './ReplayToolbar';
import { LocalStorageSaveLoadAdapter } from '../../lib/saveLoadAdapter';

interface TradingViewChartProps {
  containerId?: string;
  datafeedUrl?: string;
}

export const TradingViewChart: React.FC<TradingViewChartProps> = ({ 
  containerId = 'tv_chart_container', 
  datafeedUrl = ''
}) => {
  const { theme } = useThemeStore();
  const tvTheme = theme === 'dark' ? 'Dark' : 'Light';

  // Instantiate save load adapter to persist drawings, studies, and layouts
  const saveLoadAdapter = useMemo(() => {
    return new LocalStorageSaveLoadAdapter();
  }, []);

  const { isReady, chartActions } = useChartWidget(containerId, datafeedUrl, tvTheme, undefined, saveLoadAdapter);

  return (
    <div className="w-full h-full relative">
      <ReplayToolbar 
        onSelectBarRequested={chartActions.requestBarSelection}
        onCancelSelectBar={chartActions.cancelBarSelection}
        onResetChart={chartActions.resetChart}
      />
      <div id={containerId} className="w-full h-full" />
      {!isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-tv-bg text-tv-text pointer-events-none z-10">
          Loading Chart...
        </div>
      )}
    </div>
  );
};
