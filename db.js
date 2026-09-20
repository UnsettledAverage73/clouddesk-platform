const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const USERS_FILE = path.join(DB_DIR, 'users.json');
const ORDERS_FILE = path.join(DB_DIR, 'orders.json');
const PASSES_FILE = path.join(DB_DIR, 'passes.json');
const AWS_ACCOUNTS_FILE = path.join(DB_DIR, 'aws_accounts.json');

// Supabase Configuration
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

let supabase = null;
if (isSupabaseConfigured) {
    try {
        supabase = createClient(supabaseUrl, supabaseKey);
        console.log('⚡ Connected to Supabase PostgreSQL Database');
    } catch (e) {
        console.warn('⚠️ Failed to initialize Supabase client, using local JSON fallback:', e.message);
    }
} else {
    console.log('📦 Using Local JSON Database (Set SUPABASE_URL & SUPABASE_ANON_KEY to connect cloud database)');
}

// -------------------------------------------------------------
// JSON Helper Functions
// -------------------------------------------------------------
function readFile(filePath, defaultVal = []) {
    try {
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultVal, null, 2));
            return defaultVal;
        }
        const content = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(content || '[]');
    } catch (e) {
        console.error(`Error reading ${filePath}:`, e);
        return defaultVal;
    }
}

function writeFile(filePath, data) {
    try {
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error(`Error writing to ${filePath}:`, e);
    }
}

// -------------------------------------------------------------
// USERS
// -------------------------------------------------------------
async function getUsers() {
    if (supabase) {
        try {
            const { data, error } = await supabase.from('users').select('*');
            if (!error && data) {
                return data.map(u => ({
                    id: u.id,
                    name: u.name,
                    email: u.email,
                    phone: u.phone,
                    password: u.password,
                    hoursBalance: u.hours_balance,
                    createdAt: u.created_at
                }));
            }
        } catch (e) {
            console.error('Supabase getUsers error, falling back to JSON:', e.message);
        }
    }
    return readFile(USERS_FILE, []);
}

async function findUserByEmail(email) {
    if (!email) return null;
    const cleanEmail = email.trim().toLowerCase();
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .ilike('email', cleanEmail)
                .single();
            if (!error && data) {
                return {
                    id: data.id,
                    name: data.name,
                    email: data.email,
                    phone: data.phone,
                    password: data.password,
                    hoursBalance: data.hours_balance,
                    createdAt: data.created_at
                };
            }
        } catch (e) {
            console.error('Supabase findUserByEmail error, falling back to JSON:', e.message);
        }
    }
    const users = readFile(USERS_FILE, []);
    return users.find(u => u.email && u.email.toLowerCase() === cleanEmail) || null;
}

async function findUserById(id) {
    if (!id) return null;
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', id)
                .single();
            if (!error && data) {
                return {
                    id: data.id,
                    name: data.name,
                    email: data.email,
                    phone: data.phone,
                    password: data.password,
                    hoursBalance: data.hours_balance,
                    createdAt: data.created_at
                };
            }
        } catch (e) {
            console.error('Supabase findUserById error, falling back to JSON:', e.message);
        }
    }
    const users = readFile(USERS_FILE, []);
    return users.find(u => u.id === id) || null;
}

async function createUser(userData) {
    const newUser = {
        id: userData.id || ('usr_' + Math.random().toString(36).substring(2, 9)),
        createdAt: new Date().toISOString(),
        hoursBalance: userData.hoursBalance || 0,
        ...userData
    };

    if (supabase) {
        try {
            const { error } = await supabase.from('users').insert({
                id: newUser.id,
                name: newUser.name,
                email: newUser.email.toLowerCase(),
                phone: newUser.phone,
                password: newUser.password,
                hours_balance: newUser.hoursBalance,
                created_at: newUser.createdAt
            });
            if (error) console.error('Supabase createUser error:', error.message);
        } catch (e) {
            console.error('Supabase createUser exception:', e.message);
        }
    }

    // Always keep JSON mirror in sync
    const users = readFile(USERS_FILE, []);
    users.push(newUser);
    writeFile(USERS_FILE, users);
    return newUser;
}

async function updateUser(id, updates) {
    if (supabase) {
        try {
            const dbUpdates = {};
            if (updates.name !== undefined) dbUpdates.name = updates.name;
            if (updates.email !== undefined) dbUpdates.email = updates.email.toLowerCase();
            if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
            if (updates.password !== undefined) dbUpdates.password = updates.password;
            if (updates.hoursBalance !== undefined) dbUpdates.hours_balance = updates.hoursBalance;

            const { error } = await supabase.from('users').update(dbUpdates).eq('id', id);
            if (error) console.error('Supabase updateUser error:', error.message);
        } catch (e) {
            console.error('Supabase updateUser exception:', e.message);
        }
    }

    const users = readFile(USERS_FILE, []);
    const index = users.findIndex(u => u.id === id);
    if (index !== -1) {
        users[index] = { ...users[index], ...updates };
        writeFile(USERS_FILE, users);
        return users[index];
    }
    return null;
}

// -------------------------------------------------------------
// ORDERS / TRANSACTIONS
// -------------------------------------------------------------
async function getOrders() {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('orders')
                .select('*')
                .order('created_at', { ascending: false });
            if (!error && data) {
                return data.map(o => ({
                    id: o.id,
                    createdAt: o.created_at,
                    status: o.status,
                    userId: o.user_id,
                    userEmail: o.user_email,
                    planId: o.plan_id,
                    hours: o.hours,
                    amountInr: o.amount_inr,
                    amountPaise: o.amount_paise,
                    currency: o.currency,
                    razorpayOrderId: o.razorpay_order_id,
                    razorpayPaymentId: o.razorpay_payment_id,
                    razorpaySignature: o.razorpay_signature,
                    provider: o.provider,
                    completedAt: o.completed_at
                }));
            }
        } catch (e) {
            console.error('Supabase getOrders error:', e.message);
        }
    }
    return readFile(ORDERS_FILE, []);
}

async function createOrder(orderData) {
    const order = {
        id: orderData.id || ('ord_' + Math.random().toString(36).substring(2, 10)),
        createdAt: new Date().toISOString(),
        status: orderData.status || 'created',
        ...orderData
    };

    if (supabase) {
        try {
            const { error } = await supabase.from('orders').insert({
                id: order.id,
                created_at: order.createdAt,
                status: order.status,
                user_id: order.userId,
                user_email: order.userEmail,
                plan_id: order.planId,
                hours: order.hours,
                amount_inr: order.amountInr,
                amount_paise: order.amountPaise,
                currency: order.currency || 'INR',
                razorpay_order_id: order.razorpayOrderId || order.id,
                razorpay_payment_id: order.razorpayPaymentId,
                razorpay_signature: order.razorpaySignature,
                provider: order.provider || 'razorpay',
                completed_at: order.completedAt
            });
            if (error) console.error('Supabase createOrder error:', error.message);
        } catch (e) {
            console.error('Supabase createOrder exception:', e.message);
        }
    }

    const orders = readFile(ORDERS_FILE, []);
    orders.push(order);
    writeFile(ORDERS_FILE, orders);
    return order;
}

async function updateOrder(id, updates) {
    if (supabase) {
        try {
            const dbUpdates = {};
            if (updates.status !== undefined) dbUpdates.status = updates.status;
            if (updates.razorpayPaymentId !== undefined) dbUpdates.razorpay_payment_id = updates.razorpayPaymentId;
            if (updates.razorpaySignature !== undefined) dbUpdates.razorpay_signature = updates.razorpaySignature;
            if (updates.completedAt !== undefined) dbUpdates.completed_at = updates.completedAt;

            const { error } = await supabase.from('orders').update(dbUpdates).eq('id', id);
            if (error) console.error('Supabase updateOrder error:', error.message);
        } catch (e) {
            console.error('Supabase updateOrder exception:', e.message);
        }
    }

    const orders = readFile(ORDERS_FILE, []);
    const index = orders.findIndex(o => o.id === id);
    if (index !== -1) {
        orders[index] = { ...orders[index], ...updates };
        writeFile(ORDERS_FILE, orders);
        return orders[index];
    }
    return null;
}

// -------------------------------------------------------------
// PASSES
// -------------------------------------------------------------
async function getPasses() {
    if (supabase) {
        try {
            const { data, error } = await supabase.from('passes').select('*');
            if (!error && data) {
                return data.map(p => ({
                    code: p.code,
                    hours: p.hours,
                    used: p.used,
                    label: p.label,
                    redeemedBy: p.redeemed_by,
                    redeemedAt: p.redeemed_at,
                    createdAt: p.created_at
                }));
            }
        } catch (e) {
            console.error('Supabase getPasses error:', e.message);
        }
    }
    return readFile(PASSES_FILE, [
        { code: 'PASS1HR', hours: 1, used: false, label: '1-Hour Sprint Pass' },
        { code: 'PASS2HR', hours: 2, used: false, label: '2-Hour Assignment Pack' },
        { code: 'PASS3HR', hours: 3, used: false, label: '3-Hour Project Pack' }
    ]);
}

async function createPass(passData) {
    if (supabase) {
        try {
            const { error } = await supabase.from('passes').insert({
                code: passData.code.toUpperCase(),
                hours: passData.hours,
                used: passData.used || false,
                label: passData.label,
                created_at: new Date().toISOString()
            });
            if (error) console.error('Supabase createPass error:', error.message);
        } catch (e) {
            console.error('Supabase createPass exception:', e.message);
        }
    }

    const passes = readFile(PASSES_FILE, []);
    passes.push(passData);
    writeFile(PASSES_FILE, passes);
    return passData;
}

async function updatePass(code, updates) {
    const cleanCode = code.toUpperCase();
    if (supabase) {
        try {
            const dbUpdates = {};
            if (updates.used !== undefined) dbUpdates.used = updates.used;
            if (updates.redeemedBy !== undefined) dbUpdates.redeemed_by = updates.redeemedBy;
            if (updates.redeemedAt !== undefined) dbUpdates.redeemed_at = updates.redeemedAt;

            const { error } = await supabase.from('passes').update(dbUpdates).eq('code', cleanCode);
            if (error) console.error('Supabase updatePass error:', error.message);
        } catch (e) {
            console.error('Supabase updatePass exception:', e.message);
        }
    }

    const passes = readFile(PASSES_FILE, []);
    const index = passes.findIndex(p => p.code.toUpperCase() === cleanCode);
    if (index !== -1) {
        passes[index] = { ...passes[index], ...updates };
        writeFile(PASSES_FILE, passes);
        return passes[index];
    }
    return null;
}

// -------------------------------------------------------------
// AWS ACCOUNTS (Learner Lab Pool & Rotator)
// -------------------------------------------------------------
async function getAwsAccounts() {
    if (supabase) {
        try {
            const { data, error } = await supabase
                .from('aws_accounts')
                .select('*')
                .order('created_at', { ascending: true });
            if (!error && data) {
                return data.map(a => ({
                    id: a.id,
                    label: a.label,
                    accessKeyId: a.access_key_id,
                    secretAccessKey: a.secret_access_key,
                    sessionToken: a.session_token,
                    region: a.region || 'us-east-1',
                    instanceId: a.instance_id,
                    status: a.status || 'idle',
                    currentUserEmail: a.current_user_email,
                    expiresAt: a.expires_at,
                    createdAt: a.created_at
                }));
            }
        } catch (e) {
            console.error('Supabase getAwsAccounts error:', e.message);
        }
    }
    return readFile(AWS_ACCOUNTS_FILE, []);
}

async function getAvailableAwsAccount() {
    const accounts = await getAwsAccounts();
    // Return first idle account that hasn't expired
    const now = Date.now();
    return accounts.find(a => {
        const isNotExpired = !a.expiresAt || new Date(a.expiresAt).getTime() > now;
        return a.status === 'idle' && isNotExpired;
    }) || accounts[0] || null;
}

async function saveAwsAccount(accountData) {
    const id = accountData.id || ('acc_' + Math.random().toString(36).substring(2, 9));
    const record = {
        id,
        createdAt: new Date().toISOString(),
        status: 'idle',
        region: 'us-east-1',
        ...accountData
    };

    if (supabase) {
        try {
            const { error } = await supabase.from('aws_accounts').upsert({
                id: record.id,
                label: record.label,
                access_key_id: record.accessKeyId,
                secret_access_key: record.secretAccessKey,
                session_token: record.sessionToken,
                region: record.region,
                instance_id: record.instanceId,
                status: record.status,
                current_user_email: record.currentUserEmail,
                expires_at: record.expiresAt,
                created_at: record.createdAt
            });
            if (error) console.error('Supabase saveAwsAccount error:', error.message);
        } catch (e) {
            console.error('Supabase saveAwsAccount exception:', e.message);
        }
    }

    const accounts = readFile(AWS_ACCOUNTS_FILE, []);
    const idx = accounts.findIndex(a => a.id === id);
    if (idx !== -1) {
        accounts[idx] = { ...accounts[idx], ...record };
    } else {
        accounts.push(record);
    }
    writeFile(AWS_ACCOUNTS_FILE, accounts);
    return record;
}

async function deleteAwsAccount(id) {
    if (supabase) {
        try {
            await supabase.from('aws_accounts').delete().eq('id', id);
        } catch (e) {
            console.error('Supabase deleteAwsAccount exception:', e.message);
        }
    }
    const accounts = readFile(AWS_ACCOUNTS_FILE, []);
    const filtered = accounts.filter(a => a.id !== id);
    writeFile(AWS_ACCOUNTS_FILE, filtered);
    return true;
}

module.exports = {
    isSupabaseConfigured,
    getUsers,
    findUserByEmail,
    findUserById,
    createUser,
    updateUser,
    getOrders,
    createOrder,
    updateOrder,
    getPasses,
    createPass,
    updatePass,
    getAwsAccounts,
    getAvailableAwsAccount,
    saveAwsAccount,
    deleteAwsAccount
};
