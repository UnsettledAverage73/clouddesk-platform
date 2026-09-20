-- =========================================================
-- CLOUDDESK DATABASE SCHEMA FOR SUPABASE (POSTGRESQL)
-- =========================================================

-- 1. Users Table (Students & Accounts)
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    password TEXT NOT NULL,
    hours_balance INT DEFAULT 0
);

-- Index for fast lookup by email
CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email));

-- 2. Orders Table (Razorpay & Pass Transactions)
CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'created',
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    user_email TEXT,
    plan_id TEXT,
    hours INT NOT NULL,
    amount_inr INT NOT NULL,
    amount_paise INT NOT NULL,
    currency TEXT DEFAULT 'INR',
    razorpay_order_id TEXT,
    razorpay_payment_id TEXT,
    razorpay_signature TEXT,
    provider TEXT DEFAULT 'razorpay',
    completed_at TIMESTAMPTZ
);

-- Index for orders by user and razorpay order id
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders (user_id);
CREATE INDEX IF NOT EXISTS idx_orders_rzp_order ON orders (razorpay_order_id);

-- 3. Passes Table (Voucher / Redeem Codes)
CREATE TABLE IF NOT EXISTS passes (
    code TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    hours INT NOT NULL,
    used BOOLEAN DEFAULT FALSE,
    label TEXT,
    redeemed_by TEXT,
    redeemed_at TIMESTAMPTZ
);

-- Pre-seed default test passes
INSERT INTO passes (code, hours, used, label) VALUES
    ('PASS1HR', 1, false, '1-Hour Sprint Pass'),
    ('PASS2HR', 2, false, '2-Hour Assignment Pack'),
    ('PASS3HR', 3, false, '3-Hour Project Pack')
ON CONFLICT (code) DO NOTHING;

-- 4. AWS Accounts Table (Learner Lab Pool & Credential Rotator)
CREATE TABLE IF NOT EXISTS aws_accounts (
    id TEXT PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    label TEXT NOT NULL,
    access_key_id TEXT NOT NULL,
    secret_access_key TEXT NOT NULL,
    session_token TEXT NOT NULL,
    region TEXT DEFAULT 'us-east-1',
    instance_id TEXT,
    status TEXT DEFAULT 'idle', -- 'idle' | 'in_use' | 'expired'
    current_user_email TEXT,
    expires_at TIMESTAMPTZ
);

-- Index for fast lookup of idle accounts
CREATE INDEX IF NOT EXISTS idx_aws_accounts_status ON aws_accounts (status);

-- 5. Row Level Security Configuration
-- Since CloudDesk backend interacts directly as a trusted Node.js API server,
-- disable RLS or allow all operations so queries and transactions succeed seamlessly:
ALTER TABLE users DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE passes DISABLE ROW LEVEL SECURITY;
ALTER TABLE aws_accounts DISABLE ROW LEVEL SECURITY;
