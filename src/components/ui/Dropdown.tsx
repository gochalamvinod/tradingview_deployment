import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  disabled?: boolean;
  separator?: boolean;
  onClick?: () => void;
}

export interface DropdownProps {
  trigger: React.ReactNode;
  items: DropdownItem[];
  placement?: 'bottom-start' | 'bottom-end' | 'top-start' | 'top-end';
}

export function Dropdown({ trigger, items, placement = 'bottom-start' }: DropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);

  const toggle = () => setIsOpen(!isOpen);

  useEffect(() => {
    if (isOpen && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      let top = rect.bottom + window.scrollY;
      let left = rect.left + window.scrollX;
      
      if (placement.includes('end')) {
        left = rect.right + window.scrollX;
      }
      if (placement.includes('top')) {
        top = rect.top + window.scrollY;
      }

      setCoords({ top, left });
      setFocusedIndex(-1);
    }
  }, [isOpen, placement]);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node) && triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex(i => Math.min(i + 1, items.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex(i => Math.max(i - 1, 0));
      }
      if (e.key === 'Enter' && focusedIndex >= 0) {
        const item = items[focusedIndex];
        if (item && !item.disabled && !item.separator) {
          item.onClick?.();
          setIsOpen(false);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, items, focusedIndex]);

  return (
    <>
      <div ref={triggerRef} onClick={toggle} className="inline-block cursor-pointer">
        {trigger}
      </div>
      {isOpen && createPortal(
        <div 
          ref={menuRef}
          style={{ 
            position: 'absolute', 
            top: coords.top, 
            left: placement.includes('end') ? undefined : coords.left,
            right: placement.includes('end') ? window.innerWidth - coords.left : undefined,
            transform: placement.includes('top') ? 'translateY(-100%)' : 'none'
          }}
          className="z-[9999] min-w-[160px] bg-[#1e222d] border border-[#2a2e39] rounded shadow-xl py-1 text-sm text-gray-200"
        >
          {items.map((item, i) => item.separator ? (
            <div key={`sep-${i}`} className="h-px bg-[#2a2e39] my-1" />
          ) : (
            <div
              key={item.id}
              className={`px-4 py-2 flex items-center gap-2 cursor-pointer
                ${item.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-[#2a2e39]'}
                ${focusedIndex === i ? 'bg-[#2a2e39]' : ''}
              `}
              onClick={() => {
                if (!item.disabled) {
                  item.onClick?.();
                  setIsOpen(false);
                }
              }}
            >
              {item.icon}
              {item.label}
            </div>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}
