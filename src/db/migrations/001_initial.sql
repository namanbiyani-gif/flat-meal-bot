CREATE TABLE household_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE household_members (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE member_whatsapp_identities (
  sender_id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  observed_push_name TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE INDEX identities_by_member
ON member_whatsapp_identities(member_id, is_active);

CREATE TABLE member_meal_defaults (
  member_id TEXT NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch', 'dinner')),
  shared_dish_portions REAL NOT NULL DEFAULT 0 CHECK (shared_dish_portions >= 0),
  roti_quantity REAL NOT NULL DEFAULT 0 CHECK (roti_quantity >= 0),
  rice_quantity REAL NOT NULL DEFAULT 0 CHECK (rice_quantity >= 0),
  paratha_quantity REAL NOT NULL DEFAULT 0 CHECK (paratha_quantity >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (member_id, meal_type)
) STRICT;

CREATE TABLE member_custom_item_defaults (
  member_id TEXT NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch', 'dinner')),
  item_key TEXT NOT NULL,
  item_label TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity >= 0),
  unit TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (member_id, meal_type, item_key)
) STRICT;

CREATE TABLE weekly_menu_defaults (
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  meal_type TEXT NOT NULL CHECK (meal_type IN ('lunch', 'dinner')),
  dish_name TEXT NOT NULL,
  carb_type TEXT NOT NULL CHECK (carb_type IN ('roti', 'rice', 'paratha', 'none')),
  notes TEXT NOT NULL DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (weekday, meal_type)
) STRICT;

CREATE TABLE inbound_messages (
  group_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  push_name TEXT NOT NULL DEFAULT '',
  from_me INTEGER NOT NULL CHECK (from_me IN (0, 1)),
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processed', 'ignored', 'failed')),
  failure_reason TEXT,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TEXT,
  PRIMARY KEY (group_id, message_id)
) STRICT;

CREATE TABLE plan_changes (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  actor_member_id TEXT NOT NULL REFERENCES household_members(id),
  target_member_id TEXT REFERENCES household_members(id),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'participation',
    'quantity_override',
    'vacation',
    'guest_count',
    'menu_override',
    'cook_note'
  )),
  action_key TEXT NOT NULL,
  scope_start_date TEXT NOT NULL,
  scope_end_date TEXT NOT NULL,
  meal_type TEXT CHECK (meal_type IS NULL OR meal_type IN ('lunch', 'dinner', 'both')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'replaced', 'reverted', 'cancelled')),
  household_impact INTEGER NOT NULL DEFAULT 0 CHECK (household_impact IN (0, 1)),
  requires_confirmation INTEGER NOT NULL DEFAULT 0 CHECK (requires_confirmation IN (0, 1)),
  confirmed_by_member_id TEXT REFERENCES household_members(id),
  confirmed_at TEXT,
  supersedes_change_id TEXT REFERENCES plan_changes(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (scope_end_date >= scope_start_date)
) STRICT;

CREATE UNIQUE INDEX one_active_change_per_key
ON plan_changes(action_key)
WHERE status = 'active';

CREATE INDEX changes_by_date
ON plan_changes(scope_start_date, scope_end_date, status);

CREATE TABLE guided_sessions (
  group_id TEXT NOT NULL,
  member_id TEXT NOT NULL REFERENCES household_members(id) ON DELETE CASCADE,
  step TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (group_id, member_id)
) STRICT;

CREATE TABLE configuration_audit (
  id TEXT PRIMARY KEY,
  actor_member_id TEXT NOT NULL REFERENCES household_members(id),
  change_type TEXT NOT NULL CHECK (change_type IN ('member_default', 'weekly_menu', 'identity_link')),
  target_key TEXT NOT NULL,
  old_value_json TEXT,
  new_value_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE daily_snapshots (
  id TEXT PRIMARY KEY,
  service_date TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  status TEXT NOT NULL CHECK (status IN ('draft', 'locked', 'superseded')),
  snapshot_hash TEXT NOT NULL,
  materialized_json TEXT NOT NULL,
  operations_text TEXT NOT NULL,
  cook_text TEXT NOT NULL,
  voice_file_path TEXT,
  locked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (service_date, version)
) STRICT;

CREATE UNIQUE INDEX one_locked_snapshot_per_date
ON daily_snapshots(service_date)
WHERE status = 'locked';

CREATE INDEX snapshots_by_date
ON daily_snapshots(service_date, version);

CREATE TABLE deliveries (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES daily_snapshots(id) ON DELETE CASCADE,
  delivery_type TEXT NOT NULL CHECK (delivery_type IN (
    'operations_announcement',
    'operations_review',
    'operations_update',
    'cook_text',
    'cook_voice'
  )),
  destination_group_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  message_id TEXT,
  last_error TEXT,
  sent_at TEXT,
  deletion_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (deletion_status IN ('not_requested', 'deleting', 'deleted', 'failed')),
  deletion_attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (deletion_attempt_count >= 0),
  deletion_error TEXT,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (snapshot_id, delivery_type)
) STRICT;

CREATE INDEX deliveries_by_status
ON deliveries(status, delivery_type);

CREATE TABLE scheduled_runs (
  service_date TEXT NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('menu_announcement', 'review_summary', 'lock_snapshot', 'cook_delivery')),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  started_at TEXT,
  completed_at TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (service_date, action_type)
) STRICT;
