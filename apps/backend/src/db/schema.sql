-- TENANCY
-- A tenant is one business using VendeYa. Every row of business data below
-- carries the tenant that owns it.
CREATE TABLE IF NOT EXISTS tenants (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'suspended')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);


-- CORE AUTHENTICATION & USER MANAGEMENT
-- `role` is the user's default role, copied onto a membership when one is
-- created. Authorization reads the membership role, not this column.
-- `is_platform_operator` marks VendeYa's own staff: they are never members of a
-- tenant but may act across tenants for support.
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'supervisor', 'sales_agent')),
    name TEXT NOT NULL,
    phone_number TEXT,
    is_platform_operator INTEGER NOT NULL DEFAULT 0 CHECK(is_platform_operator IN (0, 1)),
    is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    created_by TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);
CREATE INDEX IF NOT EXISTS idx_users_platform_operator ON users(is_platform_operator);

-- `is_available` is the agent's own switch, and it lives here rather than on the
-- account: someone who sells for two businesses goes offline for one of them
-- without dropping out of the other's assignment rotation.
CREATE TABLE IF NOT EXISTS tenant_memberships (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'developer', 'supervisor', 'sales_agent')),
    is_available INTEGER NOT NULL DEFAULT 1 CHECK(is_available IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    created_by TEXT REFERENCES users(id),
    UNIQUE(tenant_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_memberships_user ON tenant_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_memberships_tenant_role ON tenant_memberships(tenant_id, role, is_available);

-- `active_tenant_id` is the tenant scope the session is acting in. NULL means
-- unscoped, which is only meaningful for a platform operator.
CREATE TABLE IF NOT EXISTS session (
    id TEXT NOT NULL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    active_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
    expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_session_user ON session(user_id);


-- CHANNEL ACCOUNTS
-- Encrypted credential store. Values are AES-256-GCM ciphertext; nothing here
-- is readable without the key in SECRETS_KEY.
CREATE TABLE IF NOT EXISTS channel_secrets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    purpose TEXT NOT NULL CHECK(purpose IN ('access_token', 'verify_token')),
    ciphertext TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    key_id TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_channel_secrets_tenant ON channel_secrets(tenant_id);

-- One row per business phone number. `channel_type` is a column rather than an
-- assumption so a second channel can be added without reshaping the table.
--
-- `UNIQUE(id, tenant_id)` is redundant on its own - `id` is already the primary
-- key - and exists so the tables below can point a composite foreign key at it.
-- Every row that carries both `tenant_id` and `channel_account_id` references
-- the pair, not the two columns separately, which is what makes a row naming
-- tenant A alongside tenant B's number impossible rather than merely wrong.
CREATE TABLE IF NOT EXISTS channel_accounts (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_type TEXT NOT NULL DEFAULT 'whatsapp' CHECK(channel_type IN ('whatsapp')),
    waba_id TEXT,
    phone_number_id TEXT NOT NULL,
    display_phone_number TEXT,
    label TEXT,
    access_token_secret_id TEXT REFERENCES channel_secrets(id) ON DELETE SET NULL,
    verify_token_secret_id TEXT REFERENCES channel_secrets(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('active', 'pending', 'disabled')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    UNIQUE(channel_type, phone_number_id),
    UNIQUE(id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_channel_accounts_tenant ON channel_accounts(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_channel_accounts_waba ON channel_accounts(waba_id);


-- CATALOG MANAGEMENT
--
-- `UNIQUE(id, tenant_id)` is redundant against the primary key and exists for
-- the same reason as the one on `channel_accounts`: it lets `catalog_bundles`
-- point a composite foreign key here, so a bundle cannot name one tenant while
-- the period it sits in belongs to another.
CREATE TABLE IF NOT EXISTS catalog_periods (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    year_month TEXT NOT NULL,
    status TEXT DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'archived')),
    published_at INTEGER,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    UNIQUE(tenant_id, year_month),
    UNIQUE(id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_periods_status ON catalog_periods(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_periods_year_month ON catalog_periods(tenant_id, year_month DESC);

CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    brand TEXT,
    model TEXT,
    specs_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_products_category ON products(tenant_id, category);

CREATE TABLE IF NOT EXISTS catalog_bundles (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    period_id TEXT NOT NULL,
    segment TEXT NOT NULL CHECK(segment IN ('gaso', 'fnb')),
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
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    FOREIGN KEY (period_id, tenant_id)
        REFERENCES catalog_periods(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bundles_period ON catalog_bundles(tenant_id, period_id);
CREATE INDEX IF NOT EXISTS idx_bundles_filtering ON catalog_bundles(tenant_id, period_id, segment, is_active, stock_status, primary_category, price);


-- CONVERSATIONS & MESSAGING
-- Identity is (tenant, channel account, contact phone number): the same person
-- writing to two businesses, or to two of one business's numbers, is two
-- separate conversations.
CREATE TABLE IF NOT EXISTS conversations (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_account_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    client_name TEXT,
    dni TEXT,
    is_calidda_client INTEGER DEFAULT 0 CHECK(is_calidda_client IN (0, 1)),
    segment TEXT CHECK(segment IN ('fnb', 'gaso')),
    credit_line REAL,
    nse INTEGER,
    age INTEGER,
    context_data TEXT DEFAULT '{}',
    current_state TEXT GENERATED ALWAYS AS (json_extract(context_data, '$.phase.phase')) STORED,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'human_takeover', 'closed')),
    handover_reason TEXT,
    is_simulation INTEGER DEFAULT 0 CHECK(is_simulation IN (0, 1)),
    persona_id TEXT,
    last_activity_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    products_interested TEXT DEFAULT '[]',
    delivery_address TEXT,
    delivery_reference TEXT,
    assigned_agent TEXT REFERENCES users(id),
    agent_notes TEXT,
    sale_status TEXT DEFAULT 'pending' CHECK(sale_status IN ('pending', 'confirmed', 'rejected', 'no_answer')),
    recording_contract_asset_id TEXT,
    recording_audio_asset_id TEXT,
    recording_uploaded_at INTEGER,
    assignment_notified_at INTEGER,
    PRIMARY KEY (tenant_id, channel_account_id, phone_number),
    FOREIGN KEY (channel_account_id, tenant_id)
        REFERENCES channel_accounts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(tenant_id, last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_status ON conversations(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_conversations_assigned ON conversations(tenant_id, assigned_agent);
CREATE INDEX IF NOT EXISTS idx_conversations_phone ON conversations(phone_number);

CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_account_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('inbound', 'outbound')),
    type TEXT NOT NULL CHECK(type IN ('text', 'image')),
    content TEXT,
    whatsapp_message_id TEXT,
    product_id TEXT,
    status TEXT DEFAULT 'sent',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    FOREIGN KEY (channel_account_id, tenant_id)
        REFERENCES channel_accounts(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, channel_account_id, phone_number)
        REFERENCES conversations(tenant_id, channel_account_id, phone_number) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_messages_phone ON messages(tenant_id, channel_account_id, phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_whatsapp_id ON messages(whatsapp_message_id);

CREATE TABLE IF NOT EXISTS message_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_account_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    message_text TEXT NOT NULL,
    message_id TEXT UNIQUE NOT NULL,
    whatsapp_timestamp INTEGER NOT NULL,
    quoted_message_context TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'processed', 'failed')),
    aggregate_id TEXT,
    attempts INTEGER DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    processed_at INTEGER,
    FOREIGN KEY (channel_account_id, tenant_id)
        REFERENCES channel_accounts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_message_inbox_pending ON message_inbox(status, tenant_id, channel_account_id, phone_number, created_at);

CREATE TABLE IF NOT EXISTS held_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_account_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    message_text TEXT NOT NULL,
    message_id TEXT UNIQUE NOT NULL,
    whatsapp_timestamp INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    -- Set once the message has been answered. The row is kept afterwards, as
    -- message_inbox keeps its processed rows: its message_id is how a Meta
    -- redelivery is recognised, until the retention purge removes it.
    processed_at INTEGER,
    FOREIGN KEY (channel_account_id, tenant_id)
        REFERENCES channel_accounts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_held_messages_phone ON held_messages(tenant_id, channel_account_id, phone_number, created_at ASC);


-- ORDERS & SALES PROCESSING
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_account_id TEXT NOT NULL,
    order_number TEXT NOT NULL,
    conversation_phone TEXT NOT NULL,
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
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    UNIQUE(tenant_id, order_number),
    FOREIGN KEY (channel_account_id, tenant_id)
        REFERENCES channel_accounts(id, tenant_id) ON DELETE CASCADE,
    FOREIGN KEY (tenant_id, channel_account_id, conversation_phone)
        REFERENCES conversations(tenant_id, channel_account_id, phone_number)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_conversation ON orders(tenant_id, channel_account_id, conversation_phone);
CREATE INDEX IF NOT EXISTS idx_orders_agent ON orders(tenant_id, assigned_agent);


-- TESTING & DEVELOPMENT
-- `id` is typed in by the tenant's own users ("cliente_moroso"), so it is only
-- unique inside that tenant: two businesses naming a persona the same way is
-- ordinary, and a global primary key turned it into a UNIQUE constraint failure
-- on the second one. Every read here is already scoped by tenant.
CREATE TABLE IF NOT EXISTS test_personas (
    id TEXT NOT NULL,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    segment TEXT NOT NULL CHECK(segment IN ('fnb', 'gaso', 'not_eligible')),
    client_name TEXT NOT NULL,
    dni TEXT NOT NULL,
    credit_line REAL NOT NULL,
    nse INTEGER,
    is_active INTEGER DEFAULT 1 CHECK(is_active IN (0, 1)),
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    PRIMARY KEY (tenant_id, id)
);

CREATE INDEX IF NOT EXISTS idx_personas_tenant ON test_personas(tenant_id, is_active);


-- MEDIA & ASSETS
-- `visibility = 'public'` means the bytes are reachable without a session.
-- Catalog images are public by design: Meta's servers fetch the `link` we hand
-- them when sending an image message, and they present no credentials. Ids are
-- random and unguessable, and the asset row still records the owning tenant so
-- catalog reads stay scoped. Everything else ('private') is only reachable
-- through /api/assets/:id, which checks tenant scope.
--
-- `content_type` starts as the uploading browser's `File.type`, so it holds a
-- value only when that value is on the allowlist for the kind (see
-- domains/assets/content-types.ts); null means the upload claimed something
-- this deployment does not serve. Private bytes go out as an attachment
-- regardless - the column labels a download, it never decides what a browser
-- renders.
CREATE TABLE IF NOT EXISTS assets (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK(kind IN ('catalog_image', 'contract', 'recording')),
    visibility TEXT NOT NULL CHECK(visibility IN ('public', 'private')),
    storage_key TEXT NOT NULL,
    content_type TEXT,
    byte_size INTEGER,
    created_by TEXT REFERENCES users(id),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_assets_tenant ON assets(tenant_id, kind);


-- ANALYTICS & MONITORING
CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_account_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    event_type TEXT NOT NULL,
    metadata TEXT DEFAULT '{}',
    is_simulation INTEGER DEFAULT 0 CHECK(is_simulation IN (0, 1)),
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    FOREIGN KEY (channel_account_id, tenant_id)
        REFERENCES channel_accounts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_analytics_phone ON analytics_events(tenant_id, channel_account_id, phone_number);
CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(tenant_id, event_type);

CREATE TABLE IF NOT EXISTS llm_calls (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    channel_account_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,
    operation TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt TEXT NOT NULL,
    user_message TEXT NOT NULL,
    response TEXT,
    status TEXT NOT NULL CHECK(status IN ('success', 'error')),
    error_type TEXT,
    error_message TEXT,
    latency_ms INTEGER,
    tokens_prompt INTEGER,
    tokens_completion INTEGER,
    tokens_total INTEGER,
    conversation_phase TEXT,
    context_metadata TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (channel_account_id, tenant_id)
        REFERENCES channel_accounts(id, tenant_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_llm_calls_phone ON llm_calls(tenant_id, phone_number, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_operation ON llm_calls(tenant_id, operation, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_status ON llm_calls(tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(tenant_id, created_at DESC);

-- `tenant_id` is nullable: a few events (provider outages affecting the whole
-- platform) are not attributable to one tenant. Those alerts are still sent -
-- on the platform's own operations channel account, see
-- `ChannelAccountService.getPlatformOps` - so a null here is a delivered
-- platform alert, not an undeliverable one.
CREATE TABLE IF NOT EXISTS notification_traces (
    id TEXT PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
    trace_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    rule_id TEXT,
    status TEXT NOT NULL CHECK(status IN ('sent', 'skipped', 'failed')),
    reason TEXT,
    content_snapshot TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_notification_traces_trace_id ON notification_traces(trace_id);
CREATE INDEX IF NOT EXISTS idx_notification_traces_created_at ON notification_traces(tenant_id, created_at DESC);


-- AUDIT & SYSTEM CONFIGURATION
-- `tenant_id` is nullable: platform operators also act outside any tenant.
-- `user_id` is null for an action no user took. `actor` always says who did it:
-- `user:<user id>` for a person, `cli:<operating-system user>` for the terminal.
CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id),
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT,
    metadata TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at DESC);

-- Genuinely global platform configuration: deployment-wide maintenance and the
-- shared Calidda provider kill switches. Only platform operators may write it.
CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000)
);

-- Per-tenant configuration (agent round-robin cursor, per-business maintenance).
CREATE TABLE IF NOT EXISTS tenant_settings (
    tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key TEXT NOT NULL,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL DEFAULT (unixepoch('now', 'subsec') * 1000),
    PRIMARY KEY (tenant_id, key)
);
