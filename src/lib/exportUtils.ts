import jsPDF from "jspdf";
import { Transaction } from "@/types/finance";
import { PerformanceReport } from "@/types/performance";
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

    doc.setFontSize(20);
    doc.setTextColor(40);
    doc.text("Relatório Financeiro - Zafira Hub", 14, 22);

    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Período de referência: ${summary.period}`, 14, 30);
    doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm", { locale: ptBR })}`, 14, 35);

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

    doc.setFontSize(14);
    doc.text("Detalhamento de Transações", 14, yPos);
    yPos += 10;

    doc.setFontSize(10);
    doc.setFillColor(240, 240, 240);
    doc.rect(14, yPos - 5, 180, 8, "F");
    doc.setFont("helvetica", "bold");
    doc.text("Data", 16, yPos);
    doc.text("Nome", 40, yPos);
    doc.text("Categoria", 110, yPos);
    doc.text("Valor", 160, yPos);

    yPos += 8;
    doc.setFont("helvetica", "normal");

    transactions.forEach((t) => {
        if (yPos > 280) {
            doc.addPage();
            yPos = 20;
        }

        const dateStr = format(new Date(t.date), "dd/MM/yy", { locale: ptBR });
        const valueStr = t.amount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

        doc.text(dateStr, 16, yPos);
        const title = t.title.length > 35 ? t.title.substring(0, 32) + "..." : t.title;
        doc.text(title, 40, yPos);
        doc.text(t.category || "-", 110, yPos);

        if (t.type === "expense") {
            doc.setTextColor(220, 38, 38);
            doc.text(`- ${valueStr}`, 160, yPos);
        } else {
            doc.setTextColor(22, 163, 74);
            doc.text(`+ ${valueStr}`, 160, yPos);
        }

        doc.setTextColor(0);
        yPos += 8;
    });

    doc.save("relatorio-financeiro-zafira.pdf");
}

/**
 * ============================================================================
 * GERADOR DE RELATÓRIO PDF PROFISSIONAL DE TRÁFEGO PAGO
 * ============================================================================
 * 
 * Estrutura de 10 seções:
 * 1. Identificação do Relatório
 * 2. Resumo Executivo
 * 3. Visão Geral de Investimento e Resultados
 * 4. Desempenho por Campanha
 * 5. Desempenho por Público (condicional)
 * 6. Análise de Criativos (condicional)
 * 7. Funil de Conversão
 * 8. Indicadores Financeiros (condicional)
 * 9. Comparativo com Período Anterior
 * 10. Análise Estratégica e Recomendações
 */
export async function generatePerformanceReport(
    report: PerformanceReport,
    clientName: string,
    aiInsight: string | null = null,
    orientation: 'portrait' | 'landscape' = 'portrait'
) {
    // ==================== CONFIGURAÇÃO INICIAL ====================
    const doc = new jsPDF({ orientation, unit: 'mm', format: 'a4' });
    const pageWidth = orientation === 'landscape' ? 297 : 210;
    const pageHeight = orientation === 'landscape' ? 210 : 297;
    const margin = 14;
    const contentWidth = pageWidth - (margin * 2);
    let y = margin;

    // ==================== PALETA DE CORES ====================
    const colors = {
        primary: [88, 66, 190] as [number, number, number],
        primaryLight: [139, 122, 240] as [number, number, number],
        secondary: [181, 168, 247] as [number, number, number],
        bgLight: [245, 246, 250] as [number, number, number],
        textDark: [45, 45, 68] as [number, number, number],
        textGray: [122, 122, 122] as [number, number, number],
        white: [255, 255, 255] as [number, number, number],
        success: [22, 163, 74] as [number, number, number],
        danger: [220, 38, 38] as [number, number, number],
        warning: [234, 179, 8] as [number, number, number],
    };

    const barColors: [number, number, number][] = [
        [88, 66, 190],
        [139, 122, 240],
        [181, 168, 247],
        [220, 214, 252],
    ];

    // ==================== HELPERS ====================
    const cleanText = (text: string): string => {
        return text
            .replace(/[^\x00-\x7F\u00C0-\u00FF]/g, "")
            .replace(/\*\*/g, "")
            .replace(/###/g, "")
            .replace(/#/g, "")
            .trim();
    };

    const fmtDate = (dateStr?: string): string => {
        if (!dateStr) return '';
        try {
            const d = new Date(dateStr);
            if (isNaN(d.getTime())) return dateStr;
            return format(d, "dd/MM/yyyy", { locale: ptBR });
        } catch { return dateStr; }
    };

    const fmtCurrency = (value: number): string => {
        return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const fmtNumber = (value: number): string => {
        return value.toLocaleString('pt-BR');
    };

    const fmtPercent = (value: number): string => {
        return `${value.toFixed(2)}%`;
    };

    const translateStatus = (status: string | undefined): string => {
        if (!status) return 'Ativo';
        const s = status.toLowerCase().trim();
        if (s === 'active' || s === 'ativo' || s.includes('veicul')) return 'Ativo';
        if (s.includes('conclu') || s === 'completed') return 'Concluído';
        if (s.includes('pausa') || s === 'paused') return 'Pausado';
        return status;
    };

    // Carregar logo
    let logoImg: HTMLImageElement | null = null;
    try {
        const img = new Image();
        img.crossOrigin = "anonymous";
        await new Promise<void>((resolve, reject) => {
            img.onload = () => { logoImg = img; resolve(); };
            img.onerror = reject;
            img.src = "https://i.ibb.co/Y44FV9Kv/Ativo-1-2x.png";
        });
    } catch (e) {
        console.error("Erro ao carregar logo:", e);
    }

    // ==================== FUNÇÕES DE DESENHO ====================

    const addNewPage = () => {
        doc.addPage();
        doc.setFillColor(...colors.white);
        doc.rect(0, 0, pageWidth, pageHeight, "F");
        y = margin;
    };

    const checkPageBreak = (requiredHeight: number) => {
        if (y + requiredHeight > pageHeight - 20) {
            addNewPage();
        }
    };

    const drawSectionTitle = (title: string) => {
        checkPageBreak(15);
        doc.setFillColor(...colors.primary);
        doc.roundedRect(margin, y, contentWidth, 10, 2, 2, "F");
        doc.setTextColor(...colors.white);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(title.toUpperCase(), margin + 5, y + 7);
        y += 15;
    };

    const drawSubTitle = (title: string) => {
        checkPageBreak(10);
        doc.setTextColor(...colors.textDark);
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text(title, margin, y);
        y += 6;
    };

    const drawKpiCard = (label: string, value: string, x: number, yPos: number, width: number, highlight: boolean = false) => {
        const height = 30;

        if (highlight) {
            doc.setFillColor(...colors.white);
            doc.setDrawColor(...colors.primary);
            doc.setLineWidth(0.5);
            doc.roundedRect(x, yPos, width, height, 3, 3, "FD");
            doc.setLineWidth(0.2);
        } else {
            doc.setFillColor(...colors.bgLight);
            doc.roundedRect(x, yPos, width, height, 3, 3, "F");
        }

        // Label
        doc.setTextColor(...colors.textGray);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.text(label.toUpperCase(), x + 5, yPos + 10);

        // Value
        doc.setTextColor(highlight ? colors.primary[0] : colors.textDark[0], highlight ? colors.primary[1] : colors.textDark[1], highlight ? colors.primary[2] : colors.textDark[2]);
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text(value, x + 5, yPos + 22);
    };

    const drawBarChart = (data: { label: string; value: number; color?: [number, number, number] }[], x: number, yPos: number, width: number, barHeight: number = 8) => {
        const maxValue = Math.max(...data.map(d => d.value), 1);

        data.forEach((item, idx) => {
            const barWidth = (item.value / maxValue) * (width - 60);
            const color = item.color || barColors[idx % barColors.length];
            const itemY = yPos + (idx * (barHeight + 4));

            // Label
            doc.setFontSize(7);
            doc.setTextColor(...colors.textDark);
            doc.setFont("helvetica", "normal");
            const truncLabel = item.label.length > 15 ? item.label.substring(0, 12) + "..." : item.label;
            doc.text(truncLabel, x, itemY + barHeight - 2);

            // Bar
            doc.setFillColor(...color);
            doc.roundedRect(x + 40, itemY, Math.max(barWidth, 3), barHeight, 1.5, 1.5, "F");

            // Value
            doc.setFontSize(7);
            doc.setFont("helvetica", "bold");
            doc.text(fmtCurrency(item.value), x + 45 + barWidth, itemY + barHeight - 2);
        });
    };

    const drawTable = (headers: string[], rows: string[][], colWidths: number[]) => {
        const rowHeight = 8;
        const headerHeight = 10;

        // Header
        doc.setFillColor(...colors.primary);
        doc.roundedRect(margin, y, contentWidth, headerHeight, 2, 2, "F");
        doc.setTextColor(...colors.white);
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");

        let xPos = margin + 3;
        headers.forEach((header, idx) => {
            doc.text(header, xPos, y + 7);
            xPos += colWidths[idx];
        });
        y += headerHeight + 2;

        // Rows
        rows.forEach((row, rowIdx) => {
            checkPageBreak(rowHeight + 5);

            if (rowIdx % 2 === 0) {
                doc.setFillColor(...colors.bgLight);
                doc.rect(margin, y - 3, contentWidth, rowHeight, "F");
            }

            doc.setTextColor(...colors.textDark);
            doc.setFontSize(7);
            doc.setFont("helvetica", "normal");

            xPos = margin + 3;
            row.forEach((cell, cellIdx) => {
                const truncCell = cell.length > 25 ? cell.substring(0, 22) + "..." : cell;
                doc.text(truncCell, xPos, y + 3);
                xPos += colWidths[cellIdx];
            });
            y += rowHeight;
        });
    };

    const drawFunnel = (steps: { label: string; value: number; rate?: string }[], x: number, yPos: number, width: number) => {
        const stepHeight = 25;
        const maxWidth = width;
        const minWidth = width * 0.3;

        steps.forEach((step, idx) => {
            const ratio = 1 - (idx * 0.25);
            const barWidth = minWidth + (maxWidth - minWidth) * ratio;
            const barX = x + (maxWidth - barWidth) / 2;
            const stepY = yPos + (idx * stepHeight);
            const color = barColors[idx % barColors.length];

            // Bar
            doc.setFillColor(...color);
            doc.roundedRect(barX, stepY, barWidth, stepHeight - 5, 3, 3, "F");

            // Label + Value
            doc.setTextColor(...colors.white);
            doc.setFontSize(9);
            doc.setFont("helvetica", "bold");
            doc.text(`${step.label}: ${fmtNumber(step.value)}`, barX + 5, stepY + 10);

            if (step.rate) {
                doc.setFontSize(8);
                doc.setFont("helvetica", "normal");
                doc.text(step.rate, barX + 5, stepY + 17);
            }
        });
    };

    // ==================== PÁGINA 1: CAPA + RESUMO EXECUTIVO ====================
    doc.setFillColor(...colors.white);
    doc.rect(0, 0, pageWidth, pageHeight, "F");

    // Header com logo
    doc.setFillColor(...colors.primary);
    doc.rect(0, 0, pageWidth, 40, "F");

    if (logoImg) {
        doc.addImage(logoImg, "PNG", margin, 10, 50, 20);
    }

    doc.setTextColor(...colors.white);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text("RELATÓRIO DE PERFORMANCE", pageWidth - margin, 18, { align: "right" });
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text("TRÁFEGO PAGO", pageWidth - margin, 28, { align: "right" });

    y = 55;

    // --- SEÇÃO 1: IDENTIFICAÇÃO ---
    drawSectionTitle("1. Identificação do Relatório");

    // Card de identificação
    doc.setFillColor(...colors.bgLight);
    doc.roundedRect(margin, y, contentWidth, 35, 4, 4, "F");

    doc.setTextColor(...colors.textDark);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text(clientName.toUpperCase(), margin + 10, y + 12);

    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.textGray);

    let periodText = new Date(report.month + '-02').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    if (report.startDate && report.endDate) {
        periodText = `${fmtDate(report.startDate)} a ${fmtDate(report.endDate)}`;
    }

    doc.text(`Período: ${periodText}`, margin + 10, y + 20);
    doc.text(`Plataforma: Meta Ads`, margin + 10, y + 27);
    doc.text(`Gerado em: ${format(new Date(), "dd/MM/yyyy HH:mm")}`, contentWidth - 30, y + 27);

    y += 45;

    // --- SEÇÃO 2: RESUMO EXECUTIVO ---
    drawSectionTitle("2. Resumo Executivo");

    const cpa = report.totalResults > 0 ? report.totalSpend / report.totalResults : 0;

    const resumoText = [
        `No periodo analisado, o investimento total foi de ${fmtCurrency(report.totalSpend)}, gerando ${fmtNumber(report.totalResults)} resultados (leads/conversoes).`,
        ``,
        `O Custo por Resultado (CPA) medio ficou em ${fmtCurrency(cpa)}, com um CTR medio de ${fmtPercent(report.avgCtr)} e CPC medio de ${fmtCurrency(report.avgCpc)}.`,
        ``,
        `Foram veiculadas ${report.campaigns.length} campanhas no periodo. A performance geral pode ser considerada ${cpa < 20 ? 'POSITIVA' : cpa < 50 ? 'MODERADA' : 'DESAFIADORA'}, com oportunidades de otimizacao identificadas.`
    ];

    doc.setFillColor(...colors.bgLight);
    doc.roundedRect(margin, y, contentWidth, 45, 4, 4, "F");

    doc.setTextColor(...colors.textDark);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");

    let textY = y + 10;
    resumoText.forEach(line => {
        if (line) {
            const splitLines = doc.splitTextToSize(line, contentWidth - 20);
            doc.text(splitLines, margin + 10, textY);
            textY += splitLines.length * 4;
        } else {
            textY += 3;
        }
    });

    y += 55;

    // --- SEÇÃO 3: VISÃO GERAL ---
    drawSectionTitle("3. Visão Geral de Investimento e Resultados");

    // KPI Cards (4 cards)
    const kpiWidth = (contentWidth - 15) / 4;
    drawKpiCard("Investimento Total", fmtCurrency(report.totalSpend), margin, y, kpiWidth, true);
    drawKpiCard("Resultados", fmtNumber(report.totalResults), margin + kpiWidth + 5, y, kpiWidth);
    drawKpiCard("CTR Médio", fmtPercent(report.avgCtr), margin + (kpiWidth + 5) * 2, y, kpiWidth);
    drawKpiCard("CPC Médio", fmtCurrency(report.avgCpc), margin + (kpiWidth + 5) * 3, y, kpiWidth);

    y += 40;

    // KPI Cards linha 2
    drawKpiCard("CPA Médio", fmtCurrency(cpa), margin, y, kpiWidth);
    drawKpiCard("Total Campanhas", fmtNumber(report.campaigns.length), margin + kpiWidth + 5, y, kpiWidth);

    y += 45;

    // ==================== PÁGINA 2: DESEMPENHO POR CAMPANHA ====================
    addNewPage();

    drawSectionTitle("4. Desempenho por Campanha");

    // Tabela de campanhas
    const tableHeaders = ["Campanha", "Status", "Invest.", "Result.", "CPA", "CTR"];
    const colWidths = [55, 25, 30, 25, 30, 20];

    const tableRows = report.campaigns.slice(0, 15).map(c => [
        cleanText(c.name),
        translateStatus(c.status),
        fmtCurrency(c.spend),
        fmtNumber(c.results),
        fmtCurrency(c.costPerResult),
        fmtPercent(c.ctr)
    ]);

    drawTable(tableHeaders, tableRows, colWidths);

    y += 15;

    // Gráfico de barras - Top 5 por investimento
    if (y + 80 < pageHeight - 20) {
        drawSubTitle("Distribuição de Investimento (Top 5)");

        const topBySpend = [...report.campaigns]
            .sort((a, b) => b.spend - a.spend)
            .slice(0, 5)
            .map(c => ({ label: cleanText(c.name), value: c.spend }));

        drawBarChart(topBySpend, margin, y, contentWidth);
        y += 70;
    }

    // ==================== PÁGINA 3: FUNIL + ANÁLISE IA ====================
    addNewPage();

    // --- SEÇÃO 7: FUNIL DE CONVERSÃO ---
    drawSectionTitle("7. Funil de Conversão");

    const totalClicks = report.campaigns.reduce((sum, c) => sum + (c.clicks || 0), 0);
    const totalImpressions = totalClicks > 0 ? Math.round(totalClicks / (report.avgCtr / 100)) : 0;

    const funnelData = [
        { label: "Impressões", value: totalImpressions, rate: "100%" },
        { label: "Cliques", value: totalClicks, rate: `Taxa: ${fmtPercent(report.avgCtr)}` },
        { label: "Conversões", value: report.totalResults, rate: `Taxa: ${totalClicks > 0 ? fmtPercent((report.totalResults / totalClicks) * 100) : "0%"}` },
    ];

    drawFunnel(funnelData, margin + 20, y, contentWidth - 40);
    y += 90;

    // --- SEÇÃO 10: ANÁLISE ESTRATÉGICA DA IA ---
    if (aiInsight) {
        drawSectionTitle("10. Análise Estratégica e Recomendações");

        const cleanedInsight = cleanText(aiInsight);
        const insightTextWidth = contentWidth - 20;
        const allLines = doc.splitTextToSize(cleanedInsight, insightTextWidth);
        const linesPerPage = 25;

        let currentLine = 0;
        while (currentLine < allLines.length) {
            const linesOnThisPage = allLines.slice(currentLine, currentLine + linesPerPage);
            const boxHeight = (linesOnThisPage.length * 4.5) + 20;

            checkPageBreak(boxHeight);

            doc.setFillColor(...colors.bgLight);
            doc.roundedRect(margin, y, contentWidth, boxHeight, 4, 4, "F");

            // Barra lateral de destaque
            doc.setFillColor(...colors.primary);
            doc.rect(margin, y + 5, 3, boxHeight - 10, "F");

            doc.setTextColor(...colors.textDark);
            doc.setFontSize(8);
            doc.setFont("helvetica", "normal");
            doc.text(linesOnThisPage, margin + 10, y + 12, { maxWidth: insightTextWidth });

            y += boxHeight + 8;
            currentLine += linesPerPage;
        }
    }

    // ==================== GLOSSÁRIO DE ABREVIAÇÕES ====================
    // Adicionar na última página antes do footer
    const totalPages = doc.internal.pages.length - 1;
    doc.setPage(totalPages);

    // Verificar se há espaço para o glossário, se não, criar nova página
    const glossarioY = pageHeight - 80;

    doc.setFillColor(...colors.bgLight);
    doc.roundedRect(margin, glossarioY, contentWidth, 45, 4, 4, "F");

    doc.setTextColor(...colors.primary);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    doc.text("GLOSSÁRIO DE TERMOS", margin + 5, glossarioY + 10);

    doc.setTextColor(...colors.textDark);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");

    const glossario = [
        "CTR (Click-Through Rate): Taxa de cliques. Porcentagem de pessoas que clicaram no anúncio após vê-lo.",
        "CPC (Cost Per Click): Custo por Clique. Valor médio pago por cada clique no anúncio.",
        "CPA (Cost Per Acquisition): Custo por Aquisição/Resultado. Valor médio pago por cada conversão ou lead gerado.",
        "ROAS (Return on Ad Spend): Retorno sobre o Investimento em Anúncios. Faturamento dividido pelo investimento.",
    ];

    let glossY = glossarioY + 18;
    glossario.forEach(item => {
        doc.text(item, margin + 5, glossY, { maxWidth: contentWidth - 10 });
        glossY += 7;
    });

    // ==================== LOGO CENTRALIZADA NA ÚLTIMA PÁGINA ====================
    if (logoImg) {
        const logoWidth = 60;
        const logoHeight = 22;
        const logoX = (pageWidth - logoWidth) / 2;
        const logoY = pageHeight - 30;

        // Fundo roxo para a logo
        doc.setFillColor(...colors.primary);
        doc.roundedRect(logoX - 5, logoY - 3, logoWidth + 10, logoHeight + 6, 4, 4, "F");

        doc.addImage(logoImg, "PNG", logoX, logoY, logoWidth, logoHeight);
    }

    // ==================== FOOTER EM TODAS AS PÁGINAS ====================
    for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        // Não colocar footer na área do glossário/logo na última página
        if (i !== totalPages) {
            doc.setFillColor(...colors.bgLight);
            doc.rect(0, pageHeight - 12, pageWidth, 12, "F");
            doc.setFontSize(7);
            doc.setTextColor(...colors.textGray);
            doc.text(`Zafira Hub © ${new Date().getFullYear()} - Documento Confidencial`, margin, pageHeight - 5);
            doc.text(`Página ${i} de ${totalPages}`, pageWidth - margin, pageHeight - 5, { align: "right" });
        }
    }

    // Salvar
    doc.save(`Relatorio_Performance_${clientName.replace(/\s+/g, '_')}_${report.month}.pdf`);
}
