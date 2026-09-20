/** The schema as it stood before tenancy, trimmed to what the test asserts on. */
export const LEGACY_SCHEMA = `
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'supervisor', 'sales_agent')),
    name TEXT NOT NULL,
    phone_number TEXT,
    is_active INTEGER DEFAULT 1,
    is_available INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    created_by TEXT
);
CREATE TABLE session (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL,
    expires_at INTEGER NOT NULL
);
CREATE TABLE catalog_periods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    year_month TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'draft',
    published_at INTEGER,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    specs_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE catalog_bundles (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL,
    segment TEXT NOT NULL CHECK(segment IN ('gaso', 'fnb')),
    name TEXT NOT NULL,
    price REAL NOT NULL,
    primary_category TEXT NOT NULL,
    categories_json TEXT,
    image_id TEXT NOT NULL,
    composition_json TEXT NOT NULL,
    installments_json TEXT NOT NULL,
    notes TEXT,
    is_active INTEGER DEFAULT 1,
    stock_status TEXT DEFAULT 'in_stock',
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE conversations (
    phone_number TEXT PRIMARY KEY,
    client_name TEXT,
    dni TEXT,
    is_calidda_client INTEGER DEFAULT 0,
    segment TEXT,
    credit_line REAL,
    nse INTEGER,
    age INTEGER,
    context_data TEXT DEFAULT '{}',
    current_state TEXT GENERATED ALWAYS AS (json_extract(context_data, '$.phase.phase')) STORED,
    status TEXT DEFAULT 'active',
    handover_reason TEXT,
    is_simulation INTEGER DEFAULT 0,
    persona_id TEXT,
    last_activity_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    products_interested TEXT DEFAULT '[]',
    delivery_address TEXT,
    delivery_reference TEXT,
    assigned_agent TEXT,
    agent_notes TEXT,
    sale_status TEXT DEFAULT 'pending',
    recording_contract_path TEXT,
    recording_audio_path TEXT,
    recording_uploaded_at INTEGER,
    assignment_notified_at INTEGER
);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL,
    direction TEXT NOT NULL,
    type TEXT NOT NULL,
    content TEXT,
    whatsapp_message_id TEXT,
    product_id TEXT,
    status TEXT DEFAULT 'sent',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE message_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    message_text TEXT NOT NULL,
    message_id TEXT UNIQUE NOT NULL,
    whatsapp_timestamp INTEGER NOT NULL,
    quoted_message_context TEXT,
    status TEXT DEFAULT 'pending',
    aggregate_id TEXT,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    processed_at INTEGER
);
CREATE TABLE held_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone_number TEXT NOT NULL,
    message_text TEXT NOT NULL,
    message_id TEXT UNIQUE NOT NULL,
    whatsapp_timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    conversation_phone TEXT NOT NULL,
    client_name TEXT NOT NULL,
    client_dni TEXT NOT NULL,
    products TEXT NOT NULL,
    total_amount REAL NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_reference TEXT,
    status TEXT DEFAULT 'pending',
    assigned_agent TEXT,
    supervisor_notes TEXT,
    calidda_notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE test_personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    segment TEXT NOT NULL,
    client_name TEXT NOT NULL,
    dni TEXT NOT NULL,
    credit_line REAL NOT NULL,
    nse INTEGER,
    is_active INTEGER DEFAULT 1,
    created_by TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE analytics_events (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    is_simulation INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE llm_calls (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL,
    operation TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    user_message TEXT NOT NULL,
    response TEXT,
    status TEXT NOT NULL,
    error_type TEXT,
    error_message TEXT,
    latency_ms INTEGER,
    tokens_prompt INTEGER,
    tokens_completion INTEGER,
    tokens_total INTEGER,
    conversation_phase TEXT,
    context_metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE notification_traces (
    id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    rule_id TEXT,
    status TEXT NOT NULL,
    reason TEXT,
    content_snapshot TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);
`;
