import type { ComponentProps, ReactElement, ReactNode } from 'react';
import {
  Area,
  Bar,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartTooltip } from './ChartTooltip';
import { chartAxisProps, chartGridProps, chartTheme } from './chart-theme';

export function ChartFrame({ children }: { children: ReactElement }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      {children}
    </ResponsiveContainer>
  );
}

export function ChartGradientDefs({
  id = 'primaryFill',
  color = chartTheme.primary,
}: {
  id?: string;
  color?: string;
}) {
  return (
    <defs>
      <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity={0.35} />
        <stop offset="100%" stopColor={color} stopOpacity={0} />
      </linearGradient>
    </defs>
  );
}

export function ThemedGrid() {
  return <CartesianGrid {...chartGridProps} />;
}

export function ThemedXAxis(props: ComponentProps<typeof XAxis>) {
  return <XAxis {...chartAxisProps} {...props} />;
}

export function ThemedYAxis(props: ComponentProps<typeof YAxis>) {
  return <YAxis {...chartAxisProps} width={48} {...props} />;
}

export function ThemedTooltip({
  formatter,
}: {
  formatter?: (value: number | string, name: string) => ReactNode;
}) {
  return (
    <Tooltip
      cursor={{ stroke: chartTheme.grid, strokeDasharray: '3 3' }}
      content={<ChartTooltip formatter={formatter} />}
    />
  );
}

export function ThemedLegend() {
  return <Legend wrapperStyle={{ fontSize: 11, color: chartTheme.axis }} iconType="circle" />;
}

export function PrimaryArea({ dataKey, fillId = 'primaryFill' }: { dataKey: string; fillId?: string }) {
  return (
    <Area
      type="monotone"
      dataKey={dataKey}
      stroke={chartTheme.primary}
      strokeWidth={2}
      fill={`url(#${fillId})`}
      connectNulls={false}
      dot={false}
      activeDot={{ r: 4, fill: chartTheme.primary }}
    />
  );
}

export function PrimaryLine({
  dataKey,
  color = chartTheme.primary,
}: {
  dataKey: string;
  color?: string;
}) {
  return (
    <Line
      type="monotone"
      dataKey={dataKey}
      stroke={color}
      strokeWidth={2}
      connectNulls={false}
      dot={false}
      activeDot={{ r: 4, fill: color }}
    />
  );
}

export function PrimaryBar({
  dataKey,
  fill = chartTheme.primary,
  radius = 4,
}: {
  dataKey: string;
  fill?: string;
  radius?: number;
}) {
  return <Bar dataKey={dataKey} fill={fill} radius={[radius, radius, 0, 0]} />;
}

export { chartTheme };
