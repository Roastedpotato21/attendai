-- PostgreSQL requires the new enum value to commit before later migrations use it.
ALTER TYPE public.channel_type ADD VALUE IF NOT EXISTS 'push';
