-- Create lead_activities table
CREATE TABLE IF NOT EXISTS public.lead_activities (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('note', 'whatsapp', 'call', 'email', 'meeting')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

-- Create policies (assuming standard authenticated access for now, similar to leads)
CREATE POLICY "Users can view activities for visible leads"
    ON public.lead_activities
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.leads
            WHERE leads.id = lead_activities.lead_id
            -- Use the same visibility logic as leads (owner or public/admin logic if applicable)
            -- For simplicity and consistency with existing simple policies:
            AND (leads.owner_id IS NULL OR leads.owner_id = auth.uid() OR auth.jwt() ->> 'role' IN ('admin', 'manager'))
        )
    );

CREATE POLICY "Users can insert activities for visible leads"
    ON public.lead_activities
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.leads
            WHERE leads.id = lead_activities.lead_id
            AND (leads.owner_id IS NULL OR leads.owner_id = auth.uid() OR auth.jwt() ->> 'role' IN ('admin', 'manager'))
        )
    );

-- Add simple index
CREATE INDEX IF NOT EXISTS idx_lead_activities_lead_id ON public.lead_activities(lead_id);
