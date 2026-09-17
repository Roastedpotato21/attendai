-- Add SMS-specific tracking fields to communications table
-- This allows tracking individual SMS sends with provider details

ALTER TABLE communications 
ADD COLUMN provider_message_id TEXT,
ADD COLUMN sms_status TEXT,
ADD COLUMN parent_phone TEXT,
ADD COLUMN provider_name TEXT;

-- Support per-student/day lookups. Converting timestamptz through a fixed UTC
-- zone keeps the index expression immutable and valid in PostgreSQL.
CREATE INDEX idx_communications_student_date
ON communications(student_id, ((created_at AT TIME ZONE 'UTC')::date));

-- Create index for SMS tracking
CREATE INDEX idx_communications_sms_status ON communications(sms_status) WHERE type = 'sms';
