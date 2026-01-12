import jsPDF from "jspdf";
import { Transaction } from "@/types/finance";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

interface FilterSummary {
    receita: number;
    despesa: number;
    caixa: number;
    period: string;
}

export function generateFinanceReport(transactions: Transaction[], summary: FilterSummary) {
    const doc = new jsPDF();

    // Title
    doc.setFontSize(20);
    doc.setTextColor(40);
    doc.text("Relatório Financeiro - Zafira Hub", 14, 22);

    // Period Info
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Período de referência: ${summary.period}`, 14, 30);
    doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}`, 14, 35);

    // Summary Cards (simple text representation)
    let yPos = 50;
    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text("Resumo do Período", 14, yPos);
    yPos += 10;

    doc.setFontSize(12);
    doc.text(`Receita Total: ${summary.receita.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 14, yPos);
    doc.text(`Despesa Total: ${summary.despesa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 14, yPos + 7);
    doc.text(`Fluxo de Caixa: ${summary.caixa.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, 14, yPos + 14);

    yPos += 30;

    // Transactions Table Header
    doc.setFontSize(14);
    doc.text("Detalhamento de Transações", 14, yPos);
    yPos += 10;

    // Simple Table Header
    doc.setFontSize(10);
    doc.setFillColor(240, 240, 240);
    doc.rect(14, yPos - 5, 180, 8, "F");
    doc.setFont("Helvetica");
    doc.setFont('helvetica', 'bold');
    doc.text("Data", 16, yPos);
    doc.text("Nome", 40, yPos);
    doc.text("Categoria", 110, yPos);
    doc.text("Valor", 160, yPos);

    yPos += 8;
    doc.setFont('helvetica', 'normal');

    // Transactions Rows
    transactions.forEach((t) => {
        if (yPos > 280) {
            doc.addPage();
            yPos = 20;
        }

        const dateStr = format(new Date(t.date), "dd/MM/yy", { locale: ptBR });
        const valueStr = t.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

        doc.text(dateStr, 16, yPos);

        // Truncate title
        const title = t.title.length > 35 ? t.title.substring(0, 32) + "..." : t.title;
        doc.text(title, 40, yPos);

        doc.text(t.category || "-", 110, yPos);

        if (t.type === "expense") {
            doc.setTextColor(220, 38, 38); // Red
            doc.text(`- ${valueStr}`, 160, yPos);
        } else {
            doc.setTextColor(22, 163, 74); // Green
            doc.text(`+ ${valueStr}`, 160, yPos);
        }

        doc.setTextColor(0); // Reset
        yPos += 8;
    });

    // Save
    doc.save("relatorio-financeiro-zafira.pdf");
}
