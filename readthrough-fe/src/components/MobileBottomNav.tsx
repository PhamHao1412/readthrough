import React from 'react';
import { NavLink } from 'react-router-dom';
import { Library, Sparkles, Flame } from 'lucide-react';

interface MobileBottomNavProps {
  booksCount: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({ booksCount }) => {
  return (
    <nav className="mobile-bottom-nav">
      <NavLink
        to="/"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
        end
      >
        <Library size={20} />
        <span>Library ({booksCount})</span>
      </NavLink>

      <NavLink
        to="/vocab"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
      >
        <Sparkles size={20} />
        <span>Vocab</span>
      </NavLink>

      <NavLink
        to="/stats"
        className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}
      >
        <Flame size={20} />
        <span>Stats & Streak</span>
      </NavLink>
    </nav>
  );
};
