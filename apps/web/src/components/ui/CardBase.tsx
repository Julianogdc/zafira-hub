import { cn } from "@/lib/utils";

interface CardBaseProps {
    children: React.ReactNode;
    className?: string;
    gradient?: boolean; // Optional: adds a subtle gradient
}

/**
 * CardBase
 * Standard container for all major modules (CRM, Finance, Projects).
 * Ensures consistent borders, background blur, and spacing.
 */
export function CardBase({ children, className, gradient = false }: CardBaseProps) {
    return (
        <div
            className={cn(
                "relative overflow-hidden rounded-xl border border-white/10 shadow-sm transition-all",
                "bg-zinc-950/50 backdrop-blur-md", // Default glass style
                gradient && "bg-gradient-to-br from-zinc-900/50 to-zinc-950/50",
                className
            )}
        >
            {/* Optional: Add a subtle inner glow or noise texture here later */}
            <div className="relative z-10">
                {children}
            </div>
        </div>
    );
}
