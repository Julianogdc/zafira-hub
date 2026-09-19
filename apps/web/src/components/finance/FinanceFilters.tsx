
import { Button } from "@/components/ui/button";
import { PeriodFilter } from "@/hooks/useFinanceMetrics";
import { Calendar as CalendarIcon, Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { addDays, format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { DateRange } from "react-day-picker";
import { cn } from "@/lib/utils";
import { Calendar } from "@/components/ui/calendar";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";

interface FinanceFiltersProps {
    period: PeriodFilter;
    setPeriod: (p: PeriodFilter) => void;
    dateRange: DateRange | undefined;
    setDateRange: (range: DateRange | undefined) => void;
}

export function FinanceFilters({
    period,
    setPeriod,
    dateRange,
    setDateRange
}: FinanceFiltersProps) {

    const handleClearRange = (e: React.MouseEvent) => {
        e.stopPropagation();
        setDateRange(undefined);
        setPeriod("current-month");
    };

    const navigateMonth = (direction: -1 | 1) => {
        // If custom range is set, shift it?
        // Simpler: If we are viewing a month, go to next/prev month.
        // Defaults to Current Month if nothing selected.
        let referenceDate = new Date();
        if (period === "custom" && dateRange?.from) {
            referenceDate = dateRange.from;
        } else if (period === "last-month") {
            referenceDate = addDays(new Date(), -30); // Approx
        }

        // Always snap to start of month for navigation
        const newDate = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + direction, 1);
        const lastDay = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0);

        setDateRange({ from: newDate, to: lastDay });
        setPeriod("custom");
    };

    const handlePeriodClick = (p: PeriodFilter) => {
        setPeriod(p);
        setDateRange(undefined);
    };

    return (
        <div className="flex flex-wrap gap-2 items-center">
            {/* Month Navigator */}
            <div className="flex items-center bg-white/5 rounded-lg p-0.5 border border-white/5 mr-2">
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateMonth(-1)}>
                    <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-xs font-medium px-2 min-w-[80px] text-center">
                    {dateRange?.from ? format(dateRange.from, "MMM yyyy", { locale: ptBR }) : "Atual"}
                </span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => navigateMonth(1)}>
                    <ChevronRight className="w-4 h-4" />
                </Button>
            </div>

            <Button
                size="sm"
                variant={period === "current-month" ? "default" : "outline"}
                onClick={() => handlePeriodClick("current-month")}
                className="transition-all"
            >
                Mês atual
            </Button>

            <Button
                size="sm"
                variant={period === "last-month" ? "default" : "outline"}
                onClick={() => handlePeriodClick("last-month")}
                className="transition-all"
            >
                Mês anterior
            </Button>

            <Button
                size="sm"
                variant={period === "current-year" ? "default" : "outline"}
                onClick={() => handlePeriodClick("current-year")}
                className="transition-all"
            >
                Ano atual
            </Button>

            {/* Custom Range Picker */}
            <div className={cn("grid gap-2", period === "custom" && "animate-in slide-in-from-left-5 duration-300")}>
                <Popover>
                    <PopoverTrigger asChild>
                        <Button
                            id="date"
                            variant={period === "custom" ? "default" : "outline"}
                            size="sm"
                            className={cn(
                                "justify-start text-left font-normal min-w-[240px] group",
                                !dateRange && "text-muted-foreground",
                                period === "custom" && "border-primary"
                            )}
                            onClick={() => setPeriod("custom")}
                        >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dateRange?.from ? (
                                <div className="flex items-center justify-between w-full">
                                    <span>
                                        {dateRange.to ? (
                                            <>
                                                {format(dateRange.from, "dd/MM/y", { locale: ptBR })} -{" "}
                                                {format(dateRange.to, "dd/MM/y", { locale: ptBR })}
                                            </>
                                        ) : (
                                            format(dateRange.from, "dd/MM/y", { locale: ptBR })
                                        )}
                                    </span>
                                    <div
                                        onClick={handleClearRange}
                                        className="ml-2 hover:bg-white/20 p-0.5 rounded-full transition-colors"
                                    >
                                        <X className="w-3 h-3" />
                                    </div>
                                </div>
                            ) : (
                                <span>Período personalizado</span>
                            )}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0 bg-[#1e1e2e] border-white/10" align="start">
                        <Calendar
                            initialFocus
                            mode="range"
                            defaultMonth={dateRange?.from}
                            selected={dateRange}
                            onSelect={(range) => {
                                setDateRange(range);
                                if (range?.from) setPeriod("custom");
                            }}
                            numberOfMonths={2}
                            locale={ptBR}
                            className="bg-[#1e1e2e] text-slate-200"
                        />
                    </PopoverContent>
                </Popover>
            </div>
        </div>
    );
}

