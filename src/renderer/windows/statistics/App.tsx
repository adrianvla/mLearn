/**
 * Statistics Window App
 * Comprehensive learning analytics dashboard with charts, heatmaps,
 * distributions, forecasts, and SRS insights.
 */

import { Component } from 'solid-js';
import { WindowWrapper } from '../../context';
import { Dashboard } from './Dashboard';
import './Statistics.css';

const StatisticsContent: Component = () => {
  return (
    <div class="statistics-window">
      <Dashboard />
    </div>
  );
};

export const StatisticsApp: Component = () => {
  return (
    <WindowWrapper showDragRegion={true}>
      <StatisticsContent />
    </WindowWrapper>
  );
};
