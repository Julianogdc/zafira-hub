-- Create crm_templates table
CREATE TABLE IF NOT EXISTS public.crm_templates (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    created_by UUID REFERENCES auth.users(id)
);

-- Enable RLS
ALTER TABLE public.crm_templates ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Enable access for authenticated users"
    ON public.crm_templates
    FOR ALL
    TO authenticated
    USING (true)
    WITH CHECK (true);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_crm_templates_created_by ON public.crm_templates(created_by);
