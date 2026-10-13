import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, Legend } from "recharts";
import { useFinanceStore } from "@/store/useFinanceStore";

type Transaction = {
    id: string;
    title: string;
    type: "income" | "expense";
    amount: number;
    category: string;
    date: string;
};

interface ExpensesPieChartProps {
    transactions: Transaction[];
}

export const ExpensesPieChart = ({ transactions }: ExpensesPieChartProps) => {
    const { categories } = useFinanceStore();
    const expenses = transactions.filter((t) => t.type === "expense");

    if (!expenses || expenses.length === 0) {
        return (
            <div className="flex h-[260px] items-center justify-center text-sm text-muted-foreground">
                Nenhuma despesa para exibir.
            </div>
        );
    }

    // Group by category
    const dataMap = expenses.reduce((acc, t) => {
        const catName = t.category || "Outros";
        acc[catName] = (acc[catName] || 0) + t.amount;
        return acc;
    }, {} as Record<string, number>);

    const data = Object.entries(dataMap)
        .map(([name, value]) => ({
            name,
            value,
            // Find color
            color: categories.find(c => c.name === name)?.color || "#94a3b8"
        }))
        .sort((a, b) => b.value - a.value);

    return (
        <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                    <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="value"
                    >
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} stroke="transparent" />
                        ))}
                    </Pie>
                    <Tooltip
                        formatter={(value: number) => value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        contentStyle={{ backgroundColor: "#1e1e2e", borderColor: "rgba(255,255,255,0.1)", color: "#fff" }}
                        itemStyle={{ color: "#fff" }}
                    />
                    <Legend
                        layout="vertical"
                        verticalAlign="middle"
                        align="right"
                        iconType="circle"
                        wrapperStyle={{ fontSize: "12px", color: "#94a3b8" }}
                    />
                </PieChart>
            </ResponsiveContainer>
        </div>
    );
};
