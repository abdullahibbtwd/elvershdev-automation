/** Shared Recharts theme for the dark obsidian dashboard. */
export const chartTheme = {
  primary: '#00C2D6',
  secondary: '#64748B',
  tertiary: '#2DD4BF',
  grid: '#1E2631',
  axis: '#94A3B8',
  tooltipBg: 'hsl(215 25% 10%)',
  tooltipBorder: 'hsl(215 18% 16%)',
  tooltipText: 'hsl(210 40% 96%)',
  fontSize: 11,
} as const;

export const chartAxisProps = {
  stroke: chartTheme.axis,
  tick: { fill: chartTheme.axis, fontSize: chartTheme.fontSize },
  tickLine: false,
  axisLine: { stroke: chartTheme.grid },
} as const;

export const chartGridProps = {
  stroke: chartTheme.grid,
  strokeDasharray: '3 3',
  vertical: false,
} as const;
