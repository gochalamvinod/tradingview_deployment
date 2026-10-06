import React, { useEffect, useState } from 'react';
import { barReplayManager, ReplayStatus } from '../../services/barReplayManager';

interface ReplayToolbarProps {
  onSelectBarRequested?: () => void;
  onCancelSelectBar?: () => void;
  onResetChart?: () => void;
}

export const ReplayToolbar: React.FC<ReplayToolbarProps> = ({
  onSelectBarRequested,
  onCancelSelectBar,
  onResetChart,
}) => {
  const [status, setStatus] = useState<ReplayStatus>(barReplayManager.getStatus());
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);

  useEffect(() => {
    const unsub = barReplayManager.subscribe((newStatus) => {
      setStatus(newStatus);
    });
    return unsub;
  }, []);

  // Keyboard shortcut listener for replay controls
  useEffect(() => {
    if (!status.isActive && !status.isSelectingBar) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) return;

      if (e.key === ' ' || e.code === 'Space') {
        e.preventDefault();
        if (status.isActive) {
          if (status.isPlaying) barReplayManager.pause();
          else barReplayManager.play();
        }
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (status.isActive) {
          barReplayManager.step();
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        if (status.isSelectingBar) {
          if (onCancelSelectBar) onCancelSelectBar();
          barReplayManager.setIsSelectingBar(false);
        } else if (status.isActive) {
          barReplayManager.exitReplay(onResetChart);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [status.isActive, status.isPlaying, status.isSelectingBar, onCancelSelectBar, onResetChart]);

  if (!status.isActive && !status.isSelectingBar) {
    return null;
  }

  const formatReplayDate = (sec: number) => {
    if (!sec || sec <= 0) return 'Selecting bar...';
    const d = new Date(sec * 1000);
    return d.toISOString().replace('T', ' ').substring(0, 16) + ' UTC';
  };

  const speeds = [
    { label: '0.1x', val: 0.1 },
    { label: '0.5x', val: 0.5 },
    { label: '1x', val: 1 },
    { label: '2x', val: 2 },
    { label: '5x', val: 5 },
    { label: '10x', val: 10 },
  ];

  return (
    <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1.5 bg-[#1e222d]/95 backdrop-blur-md text-[#d1d4dc] border border-[#2a2e39] rounded-lg shadow-2xl px-3 py-1.5 text-xs select-none">
      {status.isSelectingBar ? (
        <div className="flex items-center gap-3 py-0.5">
          <div className="flex items-center gap-2 text-blue-400 font-medium animate-pulse">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
            </svg>
            <span>Click any candle on the chart to crop / replay from</span>
          </div>
          <button
            onClick={() => {
              if (onCancelSelectBar) onCancelSelectBar();
              barReplayManager.setIsSelectingBar(false);
            }}
            className="px-2.5 py-1 bg-[#2a2e39] hover:bg-[#363a45] text-gray-300 rounded font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      ) : (
        <>
          {/* Badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-semibold border border-blue-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
            <span>REPLAY</span>
          </div>

          {status.isHandshakeInProgress && (
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-medium border border-amber-500/30 animate-pulse text-[11px]">
              <svg className="animate-spin h-3 w-3 text-amber-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span>{status.handshakeMessage || `Handshake: Loading ${status.currentResolution}...`}</span>
            </div>
          )}

          {/* Jump / Select New Bar */}
          <button
            title="Jump to another bar (Crop)"
            disabled={status.isHandshakeInProgress}
            onClick={() => {
              if (onSelectBarRequested) onSelectBarRequested();
            }}
            className="p-1.5 hover:bg-[#2a2e39] text-gray-300 hover:text-white rounded transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="6" cy="6" r="3"/>
              <circle cx="6" cy="18" r="3"/>
              <line x1="20" y1="4" x2="8.12" y2="15.88"/>
              <line x1="14.47" y1="14.48" x2="20" y2="20"/>
              <line x1="8.12" y1="8.12" x2="12" y2="12"/>
            </svg>
          </button>

          <div className="h-4 w-[1px] bg-[#2a2e39] mx-1" />

          {/* Play / Pause */}
          <button
            title={status.isHandshakeInProgress ? 'Handshake in progress...' : (status.isPlaying ? 'Pause (Space)' : 'Play (Space)')}
            disabled={status.isHandshakeInProgress}
            onClick={() => {
              if (status.isHandshakeInProgress) return;
              if (status.isPlaying) barReplayManager.pause();
              else barReplayManager.play();
            }}
            className={`p-1.5 rounded transition-colors ${
              status.isHandshakeInProgress
                ? 'opacity-40 cursor-not-allowed bg-[#2a2e39] text-gray-400'
                : status.isPlaying 
                  ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30' 
                  : 'hover:bg-[#2a2e39] text-emerald-400 hover:text-emerald-300'
            }`}
          >
            {status.isPlaying ? (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                <path d="M8 5v14l11-7z"/>
              </svg>
            )}
          </button>

          {/* Step Forward */}
          <button
            title="Step Forward 1 Bar (Right Arrow)"
            disabled={status.isHandshakeInProgress}
            onClick={() => {
              if (status.isHandshakeInProgress) return;
              barReplayManager.step();
            }}
            className="p-1.5 hover:bg-[#2a2e39] text-gray-300 hover:text-white rounded transition-colors disabled:opacity-40"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
              <path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/>
            </svg>
          </button>

          {/* Speed Selector */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu(!showSpeedMenu)}
              title="Playback Speed"
              className="flex items-center gap-1 px-2 py-1 hover:bg-[#2a2e39] text-gray-300 hover:text-white rounded transition-colors font-medium"
            >
              <span>{status.speedMultiplier}x</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="12" height="12" fill="currentColor">
                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd"/>
              </svg>
            </button>

            {showSpeedMenu && (
              <div className="absolute top-full mt-1.5 left-0 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-xl py-1 min-w-[70px] z-50">
                {speeds.map((s) => (
                  <button
                    key={s.val}
                    onClick={() => {
                      barReplayManager.setSpeed(s.val);
                      setShowSpeedMenu(false);
                    }}
                    className={`w-full text-left px-3 py-1 hover:bg-[#2a2e39] transition-colors ${
                      status.speedMultiplier === s.val ? 'text-blue-400 font-semibold' : 'text-gray-300'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="h-4 w-[1px] bg-[#2a2e39] mx-1" />

          {/* Time & Bars Remaining */}
          <div className="flex flex-col text-[11px] text-gray-400 px-1 leading-tight">
            <span className="font-mono text-gray-200">{formatReplayDate(status.currentReplayTimeSec)}</span>
            <span className="text-[10px] text-gray-400">
              {status.futureBarsCount} future bars ({status.currentResolution})
            </span>
          </div>

          <div className="h-4 w-[1px] bg-[#2a2e39] mx-1" />

          {/* Exit / To Realtime Button */}
          <button
            title="Exit Replay and return to Live Market"
            onClick={() => {
              barReplayManager.exitReplay(onResetChart);
            }}
            className="flex items-center gap-1.5 px-2.5 py-1 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded font-medium transition-colors ml-1"
          >
            <span>Exit</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" width="14" height="14" fill="currentColor">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd"/>
            </svg>
          </button>
        </>
      )}
    </div>
  );
};
