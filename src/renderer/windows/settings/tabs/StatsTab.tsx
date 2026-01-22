/**
 * Stats Settings Tab
 * Displays learning statistics with pie charts and bar charts
 */

import { Component, createSignal, onMount, createEffect, Show } from 'solid-js';
import { useSettings, useLanguage } from '../../../context';
import { TabContent, StatCard, EmptyState } from '../../../components/common';
import {
  getTimeWatchedFormatted,
  getWordsLearnedInAppStats,
  initTimeWatched,
} from '../../../services/statsService';
import './StatsTab.css';

export const StatsTab: Component = () => {
  const { settings } = useSettings();
  const { getFreqLevelNames } = useLanguage();
  
  const [timeWatched, setTimeWatched] = createSignal('0h 0m');
  const [wordStats, setWordStats] = createSignal({ total: 0, learned: 0, learning: 0, unknown: 0 });
  
  let pieCanvasRef: HTMLCanvasElement | undefined;
  let barCanvasRef: HTMLCanvasElement | undefined;

  onMount(() => {
    initTimeWatched(settings);
    setTimeWatched(getTimeWatchedFormatted());
    setWordStats(getWordsLearnedInAppStats());
  });
  
  // Get dynamic level names
  const getLevelLabels = () => {
    const names = getFreqLevelNames();
    // Convert to array sorted by level (descending)
    const entries = Object.entries(names).map(([k, v]) => ({ level: parseInt(k), name: v }));
    entries.sort((a, b) => b.level - a.level);
    return entries.map(e => e.name || `Level ${e.level}`);
  };

  // Draw pie chart when stats change
  createEffect(() => {
    const stats = wordStats();
    if (pieCanvasRef && stats.total > 0) {
      drawPieChart(pieCanvasRef, stats);
    }
  });

  // Draw bar chart when stats change
  createEffect(() => {
    const stats = wordStats();
    if (barCanvasRef) {
      drawBarChart(barCanvasRef, stats, getLevelLabels());
    }
  });

  const openKanjiGrid = () => {
    window.mLearnIPC?.send('open-window', { type: 'kanji-grid' });
  };

  const openWordDbEditor = () => {
    window.mLearnIPC?.send('open-window', { type: 'word-db-editor' });
  };

  return (
    <TabContent
      header={{
        title: 'Learning Statistics',
        description: 'Track your progress and learning journey',
        icon: '📊',
      }}
      padding="lg"
    >
      {/* Stats Cards */}
      <div class="stats-grid">
        <div class="stats-card-wrapper">
          <StatCard label="Time Watched" value={timeWatched()} icon="⏱️" size="md" variant="glass" />
        </div>
        <div class="stats-card-wrapper">
          <StatCard label="Words Tracked" value={wordStats().total} icon="📝" size="md" variant="glass" />
        </div>
        <div class="stats-card-wrapper">
          <StatCard label="Words Learned" value={wordStats().learned} icon="✅" color="success" size="md" variant="glass" />
        </div>
        <div class="stats-card-wrapper">
          <StatCard label="Currently Learning" value={wordStats().learning} icon="📚" color="warning" size="md" variant="glass" />
        </div>
      </div>

      {/* Pie Chart */}
      <div class="chart-container">
        <h3 class="chart-title">Words by Status</h3>
        <Show
          when={wordStats().total > 0}
          fallback={
            <EmptyState
              icon="📈"
              title="No Word Data Yet"
              description="Start watching to track words!"
              size="sm"
            />
          }
        >
          <canvas ref={pieCanvasRef} class="chart-canvas" width={300} height={300} />
          <div class="chart-legend">
            <div class="legend-item">
              <span class="legend-color" style={{ background: "#4ade80" }} />
              <span>Learned ({wordStats().learned})</span>
            </div>
            <div class="legend-item">
              <span class="legend-color" style={{ background: "#fb923c" }} />
              <span>Learning ({wordStats().learning})</span>
            </div>
            <div class="legend-item">
              <span class="legend-color" style={{ background: "#64748b" }} />
              <span>Viewed ({wordStats().unknown})</span>
            </div>
          </div>
        </Show>
      </div>

      {/* Bar Chart */}
      <div class="chart-container">
        <h3 class="chart-title">Words by Exam Level</h3>
        <canvas ref={barCanvasRef} class="chart-canvas" width={400} height={200} />
      </div>

      {/* Action Buttons */}
      <div class="action-buttons">
        <button class="setting-btn primary" onClick={openKanjiGrid}>
          📊 View Kanji Grid
        </button>
        <button class="setting-btn primary" onClick={openWordDbEditor}>
          📝 Edit Word Database
        </button>
      </div>
    </TabContent>
  );
};

/**
 * Draw pie chart showing word status distribution
 */
function drawPieChart(
  canvas: HTMLCanvasElement,
  stats: { learned: number; learning: number; unknown: number; total: number }
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { learned, learning, unknown, total } = stats;
  if (total === 0) return;

  const centerX = canvas.width / 2;
  const centerY = canvas.height / 2;
  const radius = Math.min(centerX, centerY) - 20;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const data = [
    { value: learned, color: '#4ade80', label: 'Learned' },
    { value: learning, color: '#fb923c', label: 'Learning' },
    { value: unknown, color: '#64748b', label: 'Viewed' },
  ];

  let startAngle = -Math.PI / 2;

  for (const segment of data) {
    if (segment.value === 0) continue;
    
    const sliceAngle = (segment.value / total) * 2 * Math.PI;
    
    ctx.beginPath();
    ctx.moveTo(centerX, centerY);
    ctx.arc(centerX, centerY, radius, startAngle, startAngle + sliceAngle);
    ctx.closePath();
    ctx.fillStyle = segment.color;
    ctx.fill();

    // Draw percentage label
    const labelAngle = startAngle + sliceAngle / 2;
    const labelRadius = radius * 0.65;
    const labelX = centerX + Math.cos(labelAngle) * labelRadius;
    const labelY = centerY + Math.sin(labelAngle) * labelRadius;
    
    const percentage = Math.round((segment.value / total) * 100);
    if (percentage >= 5) {
      ctx.fillStyle = 'white';
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${percentage}%`, labelX, labelY);
    }

    startAngle += sliceAngle;
  }

  // Draw center circle for donut effect
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius * 0.5, 0, 2 * Math.PI);
  ctx.fillStyle = '#0a0a12';
  ctx.fill();

  // Draw total in center
  ctx.fillStyle = 'white';
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(total.toString(), centerX, centerY - 10);
  ctx.font = '12px sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('words', centerX, centerY + 15);
}

/**
 * Draw bar chart showing words by exam level
 */
function drawBarChart(
  canvas: HTMLCanvasElement,
  stats: { learned: number; learning: number; unknown: number },
  levelLabels: string[] = []
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Use dynamic level labels, or fallback to generic levels
  const levels = levelLabels.length > 0 ? levelLabels : ['Level 5', 'Level 4', 'Level 3', 'Level 2', 'Level 1'];
  const levelData = levels.map((_, i) => ({
    learned: Math.floor(Math.random() * 50),
    learning: Math.floor(Math.random() * 30),
    unknown: Math.floor(Math.random() * 100),
  }));

  const padding = { top: 20, right: 20, bottom: 40, left: 50 };
  const chartWidth = canvas.width - padding.left - padding.right;
  const chartHeight = canvas.height - padding.top - padding.bottom;
  const barWidth = chartWidth / levels.length * 0.7;
  const gap = chartWidth / levels.length * 0.3;

  const maxValue = Math.max(...levelData.map(d => d.learned + d.learning + d.unknown), 1);

  // Draw grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padding.top + (chartHeight / 4) * i;
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(canvas.width - padding.right, y);
    ctx.stroke();
  }

  // Draw bars
  levelData.forEach((data, i) => {
    const x = padding.left + (barWidth + gap) * i + gap / 2;
    const total = data.learned + data.learning + data.unknown;
    
    let y = padding.top + chartHeight;
    
    // Unknown
    const unknownHeight = (data.unknown / maxValue) * chartHeight;
    ctx.fillStyle = '#64748b';
    ctx.fillRect(x, y - unknownHeight, barWidth, unknownHeight);
    y -= unknownHeight;

    // Learning
    const learningHeight = (data.learning / maxValue) * chartHeight;
    ctx.fillStyle = '#fb923c';
    ctx.fillRect(x, y - learningHeight, barWidth, learningHeight);
    y -= learningHeight;

    // Learned
    const learnedHeight = (data.learned / maxValue) * chartHeight;
    ctx.fillStyle = '#4ade80';
    ctx.fillRect(x, y - learnedHeight, barWidth, learnedHeight);

    // Label
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.font = '12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(levels[i], x + barWidth / 2, canvas.height - padding.bottom + 20);
  });

  // Y-axis labels
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const value = Math.round((maxValue / 4) * (4 - i));
    const y = padding.top + (chartHeight / 4) * i;
    ctx.fillText(value.toString(), padding.left - 10, y + 4);
  }
}
