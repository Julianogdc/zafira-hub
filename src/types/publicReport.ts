import { PerformanceReport } from "./performance";

/**
 * Relatório público compartilhável via link
 */
export interface PublicReport {
    id: string;
    slug: string;
    client_name: string;
    report_month: string;
    report_data: PerformanceReport;
    ai_insight: string | null;
    created_by: string | null;
    created_at: string;
    expires_at: string | null;
    views: number;
}

/**
 * Dados para criar um relatório público
 */
export interface CreatePublicReportInput {
    client_name: string;
    report_month: string;
    report_data: PerformanceReport;
    ai_insight?: string | null;
    expires_in_days?: number;
}
