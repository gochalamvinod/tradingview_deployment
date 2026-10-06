import React from 'react';

export function ResizeDivider({ 
  orientation = 'vertical', 
  onResize 
}: { 
  orientation?: 'horizontal' | 'vertical', 
  onResize: (delta: number) => void 
}) {
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    let lastPos = orientation === 'vertical' ? e.clientX : e.clientY;
    
    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPos = orientation === 'vertical' ? moveEvent.clientX : moveEvent.clientY;
      const delta = currentPos - lastPos;
      lastPos = currentPos;
      onResize(delta);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div 
      className={`
        bg-[#2a2e39] hover:bg-blue-500 transition-colors z-30 shrink-0
        ${orientation === 'vertical' ? 'w-1 h-full cursor-col-resize' : 'h-1 w-full cursor-row-resize'}
      `}
      onMouseDown={handleMouseDown}
    />
  );
}
