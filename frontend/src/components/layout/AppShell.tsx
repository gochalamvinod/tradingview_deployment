import React from 'react';
import { TradingViewChart } from '../chart/TradingViewChart';
import { useThemeStore } from '../../stores/themeStore';

export function AppShell() {
  const { theme } = useThemeStore();

  React.useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <div className="w-screen h-screen overflow-hidden bg-[#131722] m-0 p-0 flex flex-row relative select-none">
      <div className="flex-1 h-full min-w-0 relative">
        <TradingViewChart />
      </div>
    </div>
  );
}
