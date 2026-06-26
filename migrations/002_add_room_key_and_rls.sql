ALTER TABLE public.shared_state
    ADD COLUMN IF NOT EXISTS room_key TEXT;

UPDATE public.shared_state
SET room_key = 'legacy'
WHERE room_key IS NULL;

ALTER TABLE public.shared_state
    ALTER COLUMN room_key SET NOT NULL;

ALTER TABLE public.shared_state
    DROP CONSTRAINT IF EXISTS shared_state_pkey;

ALTER TABLE public.shared_state
    ADD CONSTRAINT shared_state_pkey PRIMARY KEY (room_key, key);

ALTER TABLE public.shared_state ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.shared_state TO anon, authenticated;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shared_state'
          AND policyname = 'shared_state_select_public'
    ) THEN
        CREATE POLICY shared_state_select_public
            ON public.shared_state
            FOR SELECT
            TO anon, authenticated
            USING (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shared_state'
          AND policyname = 'shared_state_insert_public'
    ) THEN
        CREATE POLICY shared_state_insert_public
            ON public.shared_state
            FOR INSERT
            TO anon, authenticated
            WITH CHECK (true);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'shared_state'
          AND policyname = 'shared_state_update_public'
    ) THEN
        CREATE POLICY shared_state_update_public
            ON public.shared_state
            FOR UPDATE
            TO anon, authenticated
            USING (true)
            WITH CHECK (true);
    END IF;
END $$;
