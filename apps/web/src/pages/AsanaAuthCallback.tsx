import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { asanaService } from "@/lib/asana-service";
import { useAuthStore } from "@/store/useAuthStore";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function AsanaAuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const { updateProfile } = useAuthStore();

    useEffect(() => {
        const code = searchParams.get("code");
        const error = searchParams.get("error");

        if (error) {
            window.opener?.postMessage({ type: 'ASANA_AUTH_ERROR', error }, window.location.origin);
            window.close();
            return;
        }

        if (code) {
            window.opener?.postMessage({ type: 'ASANA_AUTH_CODE', code }, window.location.origin);
            window.close();
        }
    }, [searchParams]);

    // Cleanup: Remove unused function
    const handleExchange = async (code: string) => { };

    return (
        <div className="flex h-screen w-full items-center justify-center bg-[#0d0d12]">
            <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-10 h-10 text-purple-500 animate-spin" />
                <p className="text-slate-400">Conectando ao Asana...</p>
            </div>
        </div>
    );
}
