import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { Notification, NotificationType } from '@/types/notifications';
import { useAuthStore } from './useAuthStore';

interface NotificationStore {
    notifications: Notification[];
    unreadCount: number;
    loading: boolean;
    fetchNotifications: () => Promise<void>;
    addNotification: (title: string, message: string, type?: NotificationType, link?: string) => Promise<void>;
    markAsRead: (id: string) => Promise<void>;
    markAllAsRead: () => Promise<void>;
    clearNotification: (id: string) => Promise<void>;
}

export const useNotificationStore = create<NotificationStore>((set, get) => ({
    notifications: [],
    unreadCount: 0,
    loading: false,

    fetchNotifications: async () => {
        set({ loading: true });
        try {
            const { data, error } = await supabase
                .from('notifications')
                .select('*')
                .order('created_at', { ascending: false })
                .limit(50);

            if (error) throw error;

            const notifications = data as Notification[];
            const unreadCount = notifications.filter(n => !n.read).length;

            set({ notifications, unreadCount });
        } catch (error) {
            console.error('Error fetching notifications:', error);
        } finally {
            set({ loading: false });
        }
    },

    addNotification: async (title, message, type = 'info', link) => {
        const user = useAuthStore.getState().user;
        if (!user) return;

        try {
            const newNote = {
                user_id: user.id,
                title,
                message,
                type,
                link,
                read: false
            };

            const { data, error } = await supabase
                .from('notifications')
                .insert([newNote])
                .select()
                .single();

            if (error) throw error;

            set(state => ({
                notifications: [data, ...state.notifications],
                unreadCount: state.unreadCount + 1
            }));
        } catch (error) {
            console.error('Error adding notification:', error);
        }
    },

    markAsRead: async (id) => {
        try {
            const { error } = await supabase
                .from('notifications')
                .update({ read: true })
                .eq('id', id);

            if (error) throw error;

            set(state => {
                const updated = state.notifications.map(n =>
                    n.id === id ? { ...n, read: true } : n
                );
                return {
                    notifications: updated,
                    unreadCount: updated.filter(n => !n.read).length
                };
            });
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    },

    markAllAsRead: async () => {
        const user = useAuthStore.getState().user;
        if (!user) return;

        try {
            const { error } = await supabase
                .from('notifications')
                .update({ read: true })
                .eq('user_id', user.id)
                .eq('read', false);

            if (error) throw error;

            set(state => ({
                notifications: state.notifications.map(n => ({ ...n, read: true })),
                unreadCount: 0
            }));
        } catch (error) {
            console.error('Error marking all as read:', error);
        }
    },

    clearNotification: async (id) => {
        try {
            const { error } = await supabase
                .from('notifications')
                .delete()
                .eq('id', id);

            if (error) throw error;

            set(state => {
                const filtered = state.notifications.filter(n => n.id !== id);
                return {
                    notifications: filtered,
                    unreadCount: filtered.filter(n => !n.read).length
                };
            });
        } catch (error) {
            console.error('Error clearing notification:', error);
        }
    }
}));
