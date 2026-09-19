import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Props = {
  startDate: number;
  endDate: number;
  progress: number; // 0 a 1
};

export function GoalProgressChart({
  startDate,
  endDate,
  progress,
}: Props) {
  const now = Date.now();

  const expected =
    now <= startDate
      ? 0
      : now >= endDate
      ? 1
      : (now - startDate) / (endDate - startDate);

  const data = [
    { label: "Início", real: 0, expected: 0 },
    {
      label: "Agora",
      real: Math.round(progress * 100),
      expected: Math.round(expected * 100),
    },
    { label: "Fim", real: 100, expected: 100 },
  ];

  const isLate = progress + 0.05 < expected;

  return (
    <div className="mt-3 h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
          <XAxis dataKey="label" />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip formatter={(v: number) => `${v}%`} />

          <Line
            type="monotone"
            dataKey="expected"
            stroke="#888888"
            strokeDasharray="5 5"
            dot={false}
          />

          <Line
            type="monotone"
            dataKey="real"
            stroke={isLate ? "#f87171" : "#6366f1"}
            strokeWidth={2}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
