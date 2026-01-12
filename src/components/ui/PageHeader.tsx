import { LucideIcon } from "lucide-react";

interface PageHeaderProps {
    title: string;
    description?: string;
    icon?: LucideIcon;
    /**
     * If true, displays the Zafira Brand Logo instead of an icon.
     */
    useLogo?: boolean;
    children?: React.ReactNode;
}

export function PageHeader({ title, description, icon: Icon, useLogo, children }: PageHeaderProps) {
    return (
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between flex-wrap shrink-0 mb-6 animate-in fade-in slide-in-from-top-4 duration-500">
            <div className="flex items-start gap-4">
                {/* Trigger removed to avoid duplication with AppHeader */}

                {useLogo ? (
                    <div className="p-2 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-900/10 border border-emerald-500/20 shadow-inner">
                        {/* Zafira Abstract Logo (Same as Sidebar) */}
                        <svg width="32" height="32" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" className="text-emerald-500">
                            <path d="M20 0L37.3205 10V30L20 40L2.67949 30V10L20 0Z" fill="currentColor" fillOpacity="0.2" />
                            <path d="M20 10L28.6603 15V25L20 30L11.3397 25V15L20 10Z" stroke="currentColor" strokeWidth="2" />
                            <circle cx="20" cy="20" r="4" fill="currentColor" />
                        </svg>
                    </div>
                ) : Icon && (
                    <div className="p-3 rounded-xl bg-gradient-to-br from-emerald-500/20 to-emerald-900/10 border border-emerald-500/20 shadow-inner">
                        <Icon className="w-8 h-8 text-emerald-500" />
                    </div>
                )}
                <div className="space-y-1">
                    <h1 className="text-2xl font-bold tracking-tight text-white/90 drop-shadow-sm">
                        {title}
                    </h1>
                    {description && (
                        <p className="text-sm text-zinc-400 font-medium">
                            {description}
                        </p>
                    )}
                </div>
            </div>

            {/* Action Area */}
            {children && (
                <div className="flex items-center gap-3">
                    {children}
                </div>
            )}
        </div>
    );
}
