-- Sovereign OS Dashboard — Supabase migration
-- Target project: jjeqijptbfutrziykoff (Project A, shared PRS Supabase)
-- Prefix: sovdash_ (per prs-supabase-conventions)
-- Run this in the Supabase SQL editor for project jjeqijptbfutrziykoff

-- ─────────────────────────────────────────
-- 1. Revenue forecast (manually editable placeholder)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sovdash_revenue_forecast (
  id              UUID        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  month           DATE        NOT NULL,            -- first day of the month, e.g. 2026-06-01
  projected_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (month)
);

ALTER TABLE sovdash_revenue_forecast ENABLE ROW LEVEL SECURITY;
CREATE POLICY sovdash_revenue_forecast_service_role_all
  ON sovdash_revenue_forecast FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ─────────────────────────────────────────
-- 2. Tasks (Sascha/shared items; Gemma's tasks live in NEXT)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sovdash_tasks (
  id           UUID        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  title        TEXT        NOT NULL,
  description  TEXT,
  status       TEXT        NOT NULL DEFAULT 'todo'
                           CHECK (status IN ('todo', 'done')),
  owner        TEXT        NOT NULL DEFAULT 'shared'
                           CHECK (owner IN ('gemma', 'sascha', 'shared')),
  due_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

ALTER TABLE sovdash_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY sovdash_tasks_service_role_all
  ON sovdash_tasks FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sovdash_tasks_status  ON sovdash_tasks(status);
CREATE INDEX IF NOT EXISTS idx_sovdash_tasks_owner   ON sovdash_tasks(owner);

-- ─────────────────────────────────────────
-- 3. Action log (agent instructions + outcomes)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sovdash_actions (
  id              UUID        PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id         TEXT        NOT NULL CHECK (user_id IN ('gemma', 'sascha')),
  input_type      TEXT        NOT NULL CHECK (input_type IN ('text', 'voice', 'image', 'document')),
  raw_input       TEXT,                           -- original text or transcription
  transcription   TEXT,                           -- for voice/image/doc inputs
  interpretation  TEXT,                           -- Claude's understanding of the instruction
  proposed_action JSONB,                          -- what Claude proposes to do
  action_taken    TEXT,                           -- which tool/path was executed
  action_result   JSONB,                          -- result from the tool call
  status          TEXT        NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending_confirmation', 'confirmed', 'completed', 'failed', 'dismissed')),
  media_url       TEXT,                           -- Supabase Storage URL for voice/image/doc
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE sovdash_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sovdash_actions_service_role_all
  ON sovdash_actions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_sovdash_actions_user    ON sovdash_actions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sovdash_actions_status  ON sovdash_actions(status);

-- ─────────────────────────────────────────
-- 4. Auto-update updated_at triggers
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER sovdash_revenue_forecast_updated_at
  BEFORE UPDATE ON sovdash_revenue_forecast
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE TRIGGER sovdash_actions_updated_at
  BEFORE UPDATE ON sovdash_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
