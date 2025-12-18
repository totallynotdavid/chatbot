-- USERS
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'editor', 'viewer')),
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- SESSIONS
CREATE TABLE IF NOT EXISTS session (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
);

-- CATALOG
CREATE TABLE IF NOT EXISTS catalog_products (
    id TEXT PRIMARY KEY,
    segment TEXT NOT NULL CHECK(segment IN ('fnb', 'gaso')),
    category TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    image_main_path TEXT NOT NULL,
    image_specs_path TEXT,
    is_active BOOLEAN DEFAULT 1,
    stock_status TEXT DEFAULT 'in_stock' CHECK(stock_status IN ('in_stock', 'low_stock', 'out_of_stock')),
    created_by TEXT REFERENCES users(id),
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- CONVERSATIONS
CREATE TABLE IF NOT EXISTS conversations (
    phone_number TEXT PRIMARY KEY,
    client_name TEXT,
    dni TEXT,
    is_calidda_client BOOLEAN DEFAULT 0,
    segment TEXT,
    credit_line REAL,
    nse INTEGER,
    current_state TEXT NOT NULL DEFAULT 'INIT',
    context_data TEXT DEFAULT '{}',
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'human_takeover', 'closed')),
    last_activity_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- MESSAGES
CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    phone_number TEXT NOT NULL REFERENCES conversations(phone_number) ON DELETE CASCADE,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
    type TEXT NOT NULL,
    content TEXT,
    status TEXT DEFAULT 'sent',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- INDEXES
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(last_activity_at);
CREATE INDEX IF NOT EXISTS idx_products_segment ON catalog_products(segment);
