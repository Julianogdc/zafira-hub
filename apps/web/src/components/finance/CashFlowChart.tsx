import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type Transaction = {
  id: string;
  title: string;
  type: "income" | "expense";
  amount: number;
  category: string;
  date: string;
};

interface CashFlowChartProps {
  transactions: Transaction[];
}

export const CashFlowChart = ({ transactions }: CashFlowChartProps) => {
  if (!transactions || transactions.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
        Nenhum dado financeiro para exibir no gráfico.
      </div>
    );
  }

  // Agrupa por data
  const data = transactions.reduce<Record<string, any>>((acc, t) => {
    const day = new Date(t.date).toLocaleDateString("pt-BR");

    if (!acc[day]) {
      acc[day] = { date: day, income: 0, expense: 0 };
    }

    if (t.type === "income") acc[day].income += t.amount;
    if (t.type === "expense") acc[day].expense += t.amount;

    return acc;
  }, {});

  const chartData = Object.values(data).sort((a: any, b: any) => {
    // a.date and b.date are "DD/MM/YYYY" strings
    const [dayA, monthA, yearA] = a.date.split('/');
    const [dayB, monthB, yearB] = b.date.split('/');
    const dateA = new Date(Number(yearA), Number(monthA) - 1, Number(dayA));
    const dateB = new Date(Number(yearB), Number(monthB) - 1, Number(dayB));
    return dateA.getTime() - dateB.getTime();
  });

  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            stroke="hsl(var(--muted-foreground))"
            fontSize={12}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => {
              // value is dd/mm/yyyy
              const [day, month] = value.split('/');
              return `${day}/${month}`;
            }}
          />
          <YAxis stroke="hsl(var(--muted-foreground))" />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="income"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={false}
            name="Receita"
          />
          <Line
            type="monotone"
            dataKey="expense"
            stroke="hsl(var(--destructive))"
            strokeWidth={2}
            dot={false}
            name="Despesa"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
};
