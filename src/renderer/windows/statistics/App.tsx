/**
 * Statistics Window App
 * Learning analytics hosted by the application shell.
 */

import { Component } from 'solid-js';
import { Dashboard } from './Dashboard';
import './Statistics.css';

export const StatisticsContent: Component = () => {
  return (
    <div class="statistics-window">
      <Dashboard />
    </div>
  );
};
