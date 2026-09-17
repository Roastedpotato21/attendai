-- Add preferred_channel to parents table
CREATE TYPE channel_type AS ENUM ('sms', 'whatsapp', 'voice');

ALTER TABLE parents 
ADD COLUMN preferred_channel channel_type NOT NULL DEFAULT 'sms';

-- Create communications table
CREATE TABLE communications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    student_id UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    parent_id UUID NOT NULL REFERENCES parents(id) ON DELETE CASCADE,
    type channel_type NOT NULL,
    
    -- Voice specific
    duration_sec INTEGER,
    attempts INTEGER,
    call_status TEXT,
    sentiment TEXT,
    parent_response TEXT,
    ai_summary TEXT,
    
    -- Message specific
    message_status TEXT,
    template_id UUID,
    body TEXT,
    
    -- Unified Error Details
    error_details TEXT,
    
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc', now()) NOT NULL
);

CREATE TRIGGER set_timestamp_communications BEFORE UPDATE ON communications FOR EACH ROW EXECUTE PROCEDURE trigger_set_timestamp();
CREATE INDEX idx_communications_student ON communications(student_id);
CREATE INDEX idx_communications_parent ON communications(parent_id);
