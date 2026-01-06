CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'supervisor', 'sales_agent')),
    name TEXT NOT NULL,
    phone_number TEXT,
    is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
    is_available INTEGER DEFAULT 1 CHECK(is_available IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    created_by TEXT REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS session (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog_periods (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    year_month TEXT NOT NULL UNIQUE,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
    published_at INTEGER,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

-- Base product templates (segment-agnostic inventory)
CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    specs_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

-- GASO bundles (promotional packages with snapshotted composition)
CREATE TABLE IF NOT EXISTS catalog_bundles (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL REFERENCES catalog_periods(id),
    name TEXT NOT NULL,
    price REAL NOT NULL,
    primary_category TEXT NOT NULL,
    categories_json TEXT,
    image_id TEXT NOT NULL,
    composition_json TEXT NOT NULL,
    installments_json TEXT NOT NULL,
    notes TEXT DEFAULT '01 año de garantía, delivery gratuito, cero cuota inicial',
    is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
    stock_status TEXT DEFAULT 'in_stock' CHECK(stock_status IN ('in_stock', 'low_stock', 'out_of_stock')),
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

-- FNB offerings (individual products with segment-specific pricing)
CREATE TABLE IF NOT EXISTS catalog_fnb_offerings (
    id TEXT PRIMARY KEY,
    period_id TEXT NOT NULL REFERENCES catalog_periods(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    product_snapshot_json TEXT NOT NULL,
    price REAL NOT NULL,
    category TEXT NOT NULL,
    installments INTEGER,
    image_id TEXT NOT NULL,
    is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
    stock_status TEXT DEFAULT 'in_stock' CHECK(stock_status IN ('in_stock', 'low_stock', 'out_of_stock')),
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS conversations (
    phone_number TEXT PRIMARY KEY,
    client_name TEXT,
    dni TEXT,
    is_calidda_client INTEGER DEFAULT 0 CHECK(is_calidda_client IN (0, 1)),
    segment TEXT CHECK(segment IN ('fnb', 'gaso')),
    credit_line REAL,
    nse INTEGER,
    current_state TEXT NOT NULL DEFAULT 'INIT',
    context_data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'human_takeover', 'closed')),
    handover_reason TEXT,
    is_simulation INTEGER DEFAULT 0 CHECK(is_simulation IN (0, 1)),
    persona_id TEXT,
    last_activity_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    -- Agent workflow fields
    products_interested TEXT DEFAULT '[]',
    delivery_address TEXT,
    delivery_reference TEXT,
    assigned_agent TEXT REFERENCES users(id),
    agent_notes TEXT,
    sale_status TEXT DEFAULT 'pending' CHECK(sale_status IN ('pending', 'confirmed', 'rejected', 'no_answer')),
    -- Contract recording fields
    recording_contract_path TEXT,
    recording_audio_path TEXT,
    recording_uploaded_at INTEGER,
    assignment_notified_at INTEGER
);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL REFERENCES conversations(phone_number) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
    type TEXT NOT NULL CHECK(type IN ('text', 'image')),
    content TEXT,
    status TEXT DEFAULT 'sent',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    is_simulation INTEGER DEFAULT 0 CHECK(is_simulation IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    order_number TEXT UNIQUE NOT NULL,
    conversation_phone TEXT NOT NULL REFERENCES conversations(phone_number),
    client_name TEXT NOT NULL,
    client_dni TEXT NOT NULL,
    products TEXT NOT NULL,
    total_amount REAL NOT NULL,
    delivery_address TEXT NOT NULL,
    delivery_reference TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'supervisor_approved', 'supervisor_rejected', 'calidda_approved', 'calidda_rejected', 'delivered')),
    assigned_agent TEXT REFERENCES users(id),
    supervisor_notes TEXT,
    calidda_notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS test_personas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    segment TEXT NOT NULL CHECK(segment IN ('fnb', 'gaso', 'not_eligible')),
    client_name TEXT NOT NULL,
    dni TEXT NOT NULL,
    credit_line REAL NOT NULL,
    nse INTEGER,
    is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(status);
CREATE INDEX IF NOT EXISTS idx_periods_status ON catalog_periods(status);
CREATE INDEX IF NOT EXISTS idx_periods_year_month ON catalog_periods(year_month DESC);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
CREATE INDEX IF NOT EXISTS idx_bundles_period ON catalog_bundles(period_id);
CREATE INDEX IF NOT EXISTS idx_bundles_filtering ON catalog_bundles(period_id, is_active, stock_status, primary_category, price);
CREATE INDEX IF NOT EXISTS idx_fnb_period ON catalog_fnb_offerings(period_id);
CREATE INDEX IF NOT EXISTS idx_fnb_filtering ON catalog_fnb_offerings(period_id, is_active, stock_status, category, price);
CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_phone ON analytics_events(phone_number);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON orders(conversation_phone);
CREATE INDEX IF NOT EXISTS idx_orders_agent ON orders(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(assigned_agent);
CREATE INDEX IF NOT EXISTS idx_users_available ON users(role, is_available, is_active);
