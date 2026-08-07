import React, { useEffect, useState } from 'react';
import { Flame, Clock, Trophy, Zap, Award } from 'lucide-react';

export const ReadingStatsView: React.FC = () => {
  const [streak, setStreak] = useState<number>(3);
  const [dailyMinutes, setDailyMinutes] = useState<number>(18);
  const [dailyTarget] = useState<number>(20);
  const [readingWpm] = useState<number>(220);

  useEffect(() => {
    const savedStreak = localStorage.getItem('readthrough_reading_streak');
    const savedMinutes = localStorage.getItem('readthrough_daily_minutes');
    if (savedStreak) setStreak(parseInt(savedStreak, 10));
    if (savedMinutes) setDailyMinutes(parseInt(savedMinutes, 10));
  }, []);

  const progressPercent = Math.min(100, Math.round((dailyMinutes / dailyTarget) * 100));

  return (
    <div style={{ maxWidth: '800px', margin: '0 auto', padding: '24px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '24px' }}>
        <div style={{ padding: '10px', borderRadius: '12px', background: 'rgba(249, 115, 22, 0.15)', color: '#f97316' }}>
          <Flame size={28} />
        </div>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>Reading Statistics &amp; Daily Goal</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0' }}>
            Track your Kindle reading speed, daily habits, and achievements.
          </p>
        </div>
      </div>

      {/* Streak Banner */}
      <div style={{
        background: 'linear-gradient(135deg, rgba(249, 115, 22, 0.15), rgba(234, 88, 12, 0.05))',
        border: '1px solid rgba(249, 115, 22, 0.3)',
        borderRadius: '16px',
        padding: '20px 24px',
        marginBottom: '24px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
      }}>
        <div>
          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Daily Reading Streak
          </span>
          <h3 style={{ fontSize: '1.8rem', fontWeight: 800, margin: '6px 0 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
            🔥 {streak} Days Active!
          </h3>
          <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '4px 0 0' }}>
            Keep reading daily to build a powerful learning habit.
          </p>
        </div>
        <Trophy size={48} style={{ color: '#f97316', opacity: 0.8 }} />
      </div>

      {/* Grid of Stats Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px', marginBottom: '32px' }}>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', marginBottom: '8px', fontSize: '0.8rem', fontWeight: 600 }}>
            <Clock size={16} /> Today&apos;s Progress
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{dailyMinutes} / {dailyTarget} mins</div>
          <div style={{ height: '6px', background: 'var(--bg-secondary)', borderRadius: '99px', overflow: 'hidden', marginTop: '10px' }}>
            <div style={{ width: `${progressPercent}%`, height: '100%', background: '#f97316', borderRadius: '99px' }} />
          </div>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', marginBottom: '8px', fontSize: '0.8rem', fontWeight: 600 }}>
            <Zap size={16} /> Reading Speed
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>~{readingWpm} WPM</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Estimated ~2 min per EPUB chapter</span>
        </div>

        <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: '14px', padding: '18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-muted)', marginBottom: '8px', fontSize: '0.8rem', fontWeight: 600 }}>
            <Award size={16} /> Kindle Achievements
          </div>
          <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>Level 2 Reader</div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Next goal: 7-day reading streak</span>
        </div>
      </div>
    </div>
  );
};
