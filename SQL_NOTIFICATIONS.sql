-- Create notifications table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    type TEXT DEFAULT 'info', -- 'info', 'success', 'warning', 'error'
    read BOOLEAN DEFAULT FALSE,
    link TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- RLS
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own notifications"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id);

CREATE POLICY "System can insert notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (true); -- Ideally restricted to system functions, but for client-side triggering we might need this or use a function.
    -- Better: Users can insert notifications for themselves (e.g. reminders) or we trust the app logic for now.
    -- Let's allow authenticated users to insert for themselves or their org members? 
    -- For simplicty, let's allow insert if auth.uid() = user_id OR is_admin/system.
    -- Actually, triggers usually run on server side or via edge functions. 
    -- But since we are doing client-side logic for now (trigger on goal completion), we need insert policy.

CREATE POLICY "Users can insert notifications"
    ON public.notifications FOR INSERT
    WITH CHECK (auth.uid() = user_id);
    
-- Realtime
alter publication supabase_realtime add table notifications;
