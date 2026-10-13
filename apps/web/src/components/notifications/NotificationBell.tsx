import React, { useEffect } from 'react';
import { Bell, Check, Trash2, Info, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useNotificationStore } from '@/store/useNotificationStore';
import { formatDistanceToNow } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

export function NotificationBell() {
    const {
        notifications,
        unreadCount,
        fetchNotifications,
        markAsRead,
        markAllAsRead,
        clearNotification
    } = useNotificationStore();

    const navigate = useNavigate();
    const [open, setOpen] = React.useState(false);

    useEffect(() => {
        fetchNotifications();
        // Optional: Set up realtime subscription here or in the store
        // For now, simpler to just fetch on mount
    }, []);

    const handleNotificationClick = (id: string, link?: string) => {
        markAsRead(id);
        if (link) {
            navigate(link);
            setOpen(false);
        }
    };

    const getIcon = (type: string) => {
        switch (type) {
            case 'success': return <CheckCircle2 className="w-4 h-4 text-emerald-500" />;
            case 'warning': return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
            case 'error': return <AlertCircle className="w-4 h-4 text-red-500" />;
            default: return <Info className="w-4 h-4 text-blue-500" />;
        }
    };

    return (
        <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
                <Button variant="ghost" size="icon" className="relative text-zinc-400 hover:text-white hover:bg-zinc-800">
                    <Bell className="w-5 h-5" />
                    {unreadCount > 0 && (
                        <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    )}
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 bg-zinc-950 border-zinc-800" align="end">
                <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                    <h4 className="font-semibold text-white">Notificações</h4>
                    <div className="flex gap-2">
                        {unreadCount > 0 && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 text-xs text-zinc-400 hover:text-white"
                                onClick={() => markAllAsRead()}
                            >
                                <Check className="w-3 h-3 mr-1" /> Ler todas
                            </Button>
                        )}
                    </div>
                </div>
                <ScrollArea className="h-[300px]">
                    {notifications.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-full p-8 text-zinc-500">
                            <Bell className="w-8 h-8 mb-2 opacity-20" />
                            <p className="text-sm">Tudo tranquilo por aqui.</p>
                        </div>
                    ) : (
                        <div className="divide-y divide-zinc-800">
                            {notifications.map((notification) => (
                                <div
                                    key={notification.id}
                                    className={cn(
                                        "p-4 hover:bg-zinc-900/50 transition-colors cursor-pointer group relative",
                                        !notification.read && "bg-zinc-900/30"
                                    )}
                                    onClick={() => handleNotificationClick(notification.id, notification.link)}
                                >
                                    <div className="flex gap-3">
                                        <div className="mt-1 flex-shrink-0">
                                            {getIcon(notification.type)}
                                        </div>
                                        <div className="flex-1 space-y-1">
                                            <p className={cn("text-sm font-medium text-zinc-200", !notification.read && "text-white")}>
                                                {notification.title}
                                            </p>
                                            <p className="text-xs text-zinc-500 line-clamp-2">
                                                {notification.message}
                                            </p>
                                            <p className="text-[10px] text-zinc-600">
                                                {formatDistanceToNow(new Date(notification.created_at), { addSuffix: true, locale: ptBR })}
                                            </p>
                                        </div>
                                    </div>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="absolute top-2 right-2 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity text-zinc-500 hover:text-red-400"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            clearNotification(notification.id);
                                        }}
                                    >
                                        <Trash2 className="w-3 h-3" />
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                </ScrollArea>
            </PopoverContent>
        </Popover>
    );
}
