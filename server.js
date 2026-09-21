require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Razorpay = require('razorpay');
const crypto = require('crypto');
const {
    EC2Client,
    DescribeInstancesCommand,
    StartInstancesCommand,
    StopInstancesCommand
} = require('@aws-sdk/client-ec2');

const db = require('./db');

// Sanitize credentials to prevent invalid characters (\r, \n, whitespace) in AWS HTTP headers
const cleanCred = (val) => (typeof val === 'string' ? val.trim().replace(/[\r\n\t]/g, '') : val);
if (process.env.AWS_SESSION_TOKEN) process.env.AWS_SESSION_TOKEN = cleanCred(process.env.AWS_SESSION_TOKEN);
if (process.env.AWS_ACCESS_KEY_ID) process.env.AWS_ACCESS_KEY_ID = cleanCred(process.env.AWS_ACCESS_KEY_ID);
if (process.env.AWS_SECRET_ACCESS_KEY) process.env.AWS_SECRET_ACCESS_KEY = cleanCred(process.env.AWS_SECRET_ACCESS_KEY);

const app = express();
const PORT = process.env.PORT || 3000;
const REGION = process.env.AWS_REGION || 'us-east-1';
const INSTANCE_TAG = process.env.INSTANCE_TAG || 'AWS-Cloud-Desktop';
const JWT_SECRET = process.env.JWT_SECRET || 'clouddesk-secret-jwt-key-2026-secure';

// Owner credentials (defaults for first login, customizable via ENV)
const OWNER_USERNAME = process.env.OWNER_USERNAME || 'admin';
const OWNER_PASSWORD = process.env.OWNER_PASSWORD || 'atharva2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Favicon fallback
app.get('/favicon.ico', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'favicon.svg'), {
        headers: { 'Content-Type': 'image/svg+xml' }
    });
});

// Active AWS Node / Account ID in pool
let activeAccountId = null;

// Helper: Get active or specific EC2 client
async function getActiveEc2Client(targetAccount = null) {
    if (targetAccount) {
        return {
            client: new EC2Client({
                region: targetAccount.region || REGION,
                credentials: {
                    accessKeyId: cleanCred(targetAccount.accessKeyId),
                    secretAccessKey: cleanCred(targetAccount.secretAccessKey),
                    sessionToken: cleanCred(targetAccount.sessionToken)
                }
            }),
            account: targetAccount,
            instanceTag: targetAccount.instanceTag || INSTANCE_TAG,
            region: targetAccount.region || REGION
        };
    }

    const accounts = await db.getAwsAccounts();
    let account = null;
    if (activeAccountId) {
        account = accounts.find(a => a.id === activeAccountId);
    }
    if (!account && accounts.length > 0) {
        account = await db.getAvailableAwsAccount();
    }

    if (account && account.accessKeyId && account.secretAccessKey) {
        return {
            client: new EC2Client({
                region: account.region || REGION,
                credentials: {
                    accessKeyId: cleanCred(account.accessKeyId),
                    secretAccessKey: cleanCred(account.secretAccessKey),
                    sessionToken: cleanCred(account.sessionToken)
                }
            }),
            account: account,
            instanceTag: account.instanceTag || INSTANCE_TAG,
            region: account.region || REGION
        };
    }

    // Default to system / environment credentials
    const envCreds = (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) ? {
        accessKeyId: cleanCred(process.env.AWS_ACCESS_KEY_ID),
        secretAccessKey: cleanCred(process.env.AWS_SECRET_ACCESS_KEY),
        sessionToken: cleanCred(process.env.AWS_SESSION_TOKEN)
    } : undefined;

    return {
        client: new EC2Client({
            region: REGION,
            ...(envCreds ? { credentials: envCreds } : {})
        }),
        account: null,
        instanceTag: INSTANCE_TAG,
        region: REGION
    };
}

// Initialize Razorpay Client with credentials
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || 'rzp_test_Te2jnVAT4J1toj',
    key_secret: process.env.RAZORPAY_KEY_SECRET || 'FHr2gJAFoHZVYPKKte4qMhWQ'
});

// Session state tracking
let activeSession = {
    isActive: false,
    type: 'none', // 'owner' | 'student'
    userId: null,
    userEmail: null,
    userName: null,
    startedAt: null,
    expiresAt: null,
    timerId: null
};

// Plan Pricing Configuration
const PLANS = {
    '1hr': { id: '1hr', hours: 1, priceInr: 30, label: '1-Hour Sprint Pass' },
    '2hr': { id: '2hr', hours: 2, priceInr: 50, label: '2-Hour Assignment Pack' },
    '3hr': { id: '3hr', hours: 3, priceInr: 75, label: '3-Hour Project Pack' }
};

// Helper: Query AWS Instance State
async function getInstanceState(targetAccount = null) {
    try {
        const { client, account, instanceTag } = await getActiveEc2Client(targetAccount);
        const command = new DescribeInstancesCommand({
            Filters: [
                { Name: 'tag:Name', Values: [instanceTag] },
                { Name: 'instance-state-name', Values: ['pending', 'running', 'shutting-down', 'stopped', 'stopping'] }
            ]
        });

        const response = await client.send(command);
        const reservation = response.Reservations && response.Reservations[0];
        const instance = reservation && reservation.Instances && reservation.Instances[0];

        if (!instance) {
            return { exists: false, status: 'not_found', accountLabel: account?.label || 'Default' };
        }

        return {
            exists: true,
            instanceId: instance.InstanceId,
            state: instance.State?.Name || 'unknown',
            publicIp: instance.PublicIpAddress || null,
            instanceType: instance.InstanceType || 't3.large',
            launchTime: instance.LaunchTime || null,
            accountLabel: account?.label || 'Default Node',
            specs: {
                vCPU: 2,
                ram: '8 GB',
                storage: '30 GB SSD',
                os: 'Ubuntu 24.04 LTS',
                desktop: 'XFCE4'
            },
            ports: { webGui: 6080, vnc: 5901, rdp: 3389, ssh: 22 },
            credentials: { user: 'ubuntu', password: 'LearnerLab2026!' }
        };
    } catch (err) {
        console.error('Error in getInstanceState:', err);
        return { exists: false, error: err.message || err.toString() };
    }
}

// Helper: Boot Instance
async function bootInstance() {
    const { client } = await getActiveEc2Client();
    const info = await getInstanceState();
    if (!info.exists) throw new Error(info.error || 'Workstation instance not found in active AWS account');

    if (info.state !== 'running') {
        await client.send(new StartInstancesCommand({ InstanceIds: [info.instanceId] }));
    }

    let newIp = info.publicIp;
    for (let i = 0; i < 25; i++) {
        if (newIp && info.state === 'running') break;
        await new Promise(r => setTimeout(r, 2000));
        const check = await getInstanceState();
        if (check.state === 'running' && check.publicIp) {
            newIp = check.publicIp;
            break;
        }
    }
    return newIp;
}

// Helper: Shutdown Instance
async function shutdownInstance() {
    const { client } = await getActiveEc2Client();
    const info = await getInstanceState();
    if (info.exists && info.state === 'running') {
        await client.send(new StopInstancesCommand({ InstanceIds: [info.instanceId] }));
    }
}

// Middleware: Authenticate JWT Token
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied: No authentication token provided' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Session expired or invalid token' });
        }
        req.user = user;
        next();
    });
}

function requireOwner(req, res, next) {
    if (!req.user || req.user.role !== 'owner') {
        return res.status(403).json({ error: 'Access denied: Owner privileges required' });
    }
    next();
}

function requireStudent(req, res, next) {
    if (!req.user || (req.user.role !== 'student' && req.user.role !== 'owner')) {
        return res.status(403).json({ error: 'Access denied: Student login required' });
    }
    next();
}

// ==========================================
// 1. PUBLIC ENDPOINTS
// ==========================================

// Global Status & Current Active Session
app.get('/api/status', async (req, res) => {
    const data = await getInstanceState();
    const remainingSeconds = activeSession.expiresAt ? Math.max(0, Math.floor((activeSession.expiresAt - Date.now()) / 1000)) : null;

    res.json({
        ...data,
        session: {
            isActive: activeSession.isActive,
            type: activeSession.type,
            userEmail: activeSession.userEmail ? (activeSession.userEmail.substring(0, 3) + '***') : null,
            userName: activeSession.userName || null,
            expiresAt: activeSession.expiresAt,
            remainingSeconds: remainingSeconds
        }
    });
});

// Plans info
app.get('/api/plans', (req, res) => {
    res.json(Object.values(PLANS));
});

// ==========================================
// 2. AUTHENTICATION (OWNER & STUDENT)
// ==========================================

// Owner Login
app.post('/api/auth/owner-login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username !== OWNER_USERNAME || password !== OWNER_PASSWORD) {
        return res.status(401).json({ error: 'Invalid owner credentials' });
    }

    const token = jwt.sign(
        { role: 'owner', username: OWNER_USERNAME, id: 'owner_root' },
        JWT_SECRET,
        { expiresIn: '7d' }
    );

    res.json({
        success: true,
        token: token,
        user: { role: 'owner', username: OWNER_USERNAME, name: 'CloudDesk Owner' }
    });
});

// Student Register
app.post('/api/auth/student-register', async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = await db.findUserByEmail(email);
    if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const user = await db.createUser({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        password: hashedPassword,
        hoursBalance: 0
    });

    const token = jwt.sign(
        { role: 'student', id: user.id, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    res.json({
        success: true,
        token: token,
        user: { id: user.id, name: user.name, email: user.email, hoursBalance: user.hoursBalance }
    });
});

// Student Login
app.post('/api/auth/student-login', async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await db.findUserByEmail(email);
    if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const isMatch = bcrypt.compareSync(password, user.password);
    if (!isMatch) {
        return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
        { role: 'student', id: user.id, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: '30d' }
    );

    res.json({
        success: true,
        token: token,
        user: { id: user.id, name: user.name, email: user.email, phone: user.phone || '9637843011', hoursBalance: user.hoursBalance }
    });
});

// Get Current User Profile (Owner or Student)
app.get('/api/auth/me', authenticateToken, async (req, res) => {
    if (req.user.role === 'owner') {
        return res.json({
            role: 'owner',
            name: 'CloudDesk Owner',
            username: OWNER_USERNAME
        });
    }

    const user = await db.findUserById(req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({
        role: 'student',
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone || '9637843011',
        hoursBalance: user.hoursBalance || 0
    });
});

// ==========================================
// 3. RAZORPAY STANDARD CHECKOUT ENDPOINTS
// ==========================================

// STEP 1: Backend - Create Order
// Endpoint: POST /api/create-order
app.post(['/api/create-order', '/api/payment/create-order'], async (req, res) => {
    try {
        let { amount, currency = 'INR', receipt, planId } = req.body;
        let selectedPlan = null;
        let userId = null;
        let userEmail = null;

        // Check if optional user token was passed
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];
        if (token) {
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                userId = decoded.id;
                userEmail = decoded.email;
            } catch (e) {
                // Token optional for public checkout
            }
        }

        // If planId provided, compute amount in paise
        if (planId && PLANS[planId]) {
            selectedPlan = PLANS[planId];
            amount = selectedPlan.priceInr * 100; // in paise
        }

        // Validate amount
        if (!amount || typeof amount !== 'number') {
            amount = parseInt(amount, 10);
        }

        if (isNaN(amount) || amount < 100) {
            return res.status(400).json({
                error: 'Invalid amount: Amount must be at least 100 paise (₹1.00)'
            });
        }

        const receiptId = receipt || `rcpt_${Date.now().toString().slice(-8)}`;

        const orderOptions = {
            amount: amount,
            currency: currency,
            receipt: receiptId,
            notes: {
                planId: selectedPlan ? selectedPlan.id : 'custom',
                userId: userId || 'guest'
            }
        };

        const rzOrder = await razorpay.orders.create(orderOptions);

        // Record order in database
        await db.createOrder({
            id: rzOrder.id,
            userId: userId,
            userEmail: userEmail,
            planId: selectedPlan ? selectedPlan.id : null,
            hours: selectedPlan ? selectedPlan.hours : 0,
            amountInr: amount / 100,
            amountPaise: amount,
            currency: currency,
            razorpayOrderId: rzOrder.id,
            status: 'created',
            provider: 'razorpay'
        });

        res.status(200).json({
            order_id: rzOrder.id,
            amount: rzOrder.amount,
            currency: rzOrder.currency,
            key_id: process.env.RAZORPAY_KEY_ID
        });
    } catch (err) {
        console.error('Razorpay Order Creation Error:', err);
        res.status(500).json({
            error: err.error?.description || err.message || 'Razorpay order creation failed'
        });
    }
});

// STEP 3: Backend - Verify Payment Signature
// Endpoint: POST /api/verify-payment
app.post(['/api/verify-payment', '/api/payment/verify'], async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            orderId, // backward compatibility
            planId
        } = req.body;

        const effectiveOrderId = razorpay_order_id || orderId;

        // Validate required fields
        if (!effectiveOrderId || !razorpay_payment_id || !razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Missing required payment verification fields (order_id, payment_id, signature)'
            });
        }

        // HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
        const textToSign = effectiveOrderId + '|' + razorpay_payment_id;
        const generated_signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(textToSign)
            .digest('hex');

        // Signature comparison
        if (generated_signature !== razorpay_signature) {
            return res.status(400).json({
                success: false,
                message: 'Signature verification failed. Invalid payment signature.'
            });
        }

        // Find and update the order
        const orders = await db.getOrders();
        const order = orders.find(o => o.razorpayOrderId === effectiveOrderId || o.id === effectiveOrderId);

        let hoursCredited = 0;
        let newBalance = null;

        if (order) {
            await db.updateOrder(order.id, {
                status: 'completed',
                razorpayPaymentId: razorpay_payment_id,
                razorpaySignature: razorpay_signature,
                completedAt: new Date().toISOString()
            });

            // Credit hours to student account if user exists
            if (order.userId) {
                const user = await db.findUserById(order.userId);
                if (user) {
                    hoursCredited = order.hours || (planId && PLANS[planId] ? PLANS[planId].hours : 0);
                    newBalance = (user.hoursBalance || 0) + hoursCredited;
                    await db.updateUser(user.id, { hoursBalance: newBalance });
                }
            }
        } else if (planId && PLANS[planId]) {
            hoursCredited = PLANS[planId].hours;
        }

        res.status(200).json({
            success: true,
            message: 'Payment verified successfully!',
            payment_id: razorpay_payment_id,
            order_id: effectiveOrderId,
            hoursAdded: hoursCredited,
            newHoursBalance: newBalance
        });
    } catch (err) {
        console.error('Payment Verification Error:', err);
        res.status(500).json({
            success: false,
            error: err.message || 'Payment verification processing failed'
        });
    }
});

// Redeem Pass Code (For students who bought a code offline or in person)
app.post('/api/student/redeem-code', authenticateToken, requireStudent, async (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });

    const cleanCode = code.trim().toUpperCase();
    const passes = await db.getPasses();
    const pass = passes.find(p => p.code.toUpperCase() === cleanCode);

    if (!pass) return res.status(401).json({ error: 'Invalid pass code' });
    if (pass.used) return res.status(403).json({ error: 'This pass code has already been used' });

    const user = await db.findUserById(req.user.id);
    const newBalance = (user.hoursBalance || 0) + pass.hours;

    await db.updateUser(user.id, { hoursBalance: newBalance });
    await db.updatePass(cleanCode, { used: true, redeemedBy: user.email, redeemedAt: new Date().toISOString() });

    res.json({
        success: true,
        message: `Pass redeemed! Added +${pass.hours} hour(s) to your balance.`,
        hoursAdded: pass.hours,
        newHoursBalance: newBalance
    });
});

// ==========================================
// 4. STUDENT WORKSTATION SESSIONS
// ==========================================

// Start Student Session
app.post('/api/student/start-session', authenticateToken, requireStudent, async (req, res) => {
    const { hours = 1 } = req.body;
    const requestedHours = Math.max(1, parseInt(hours));

    const user = await db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User profile not found' });

    if ((user.hoursBalance || 0) < requestedHours) {
        return res.status(402).json({
            error: `Insufficient balance. You need ${requestedHours} hour(s) but currently have ${user.hoursBalance || 0} hour(s). Please purchase a pass.`
        });
    }

    try {
        if (activeSession.timerId) clearTimeout(activeSession.timerId);

        const newIp = await bootInstance();

        // Deduct hours from student
        const newBalance = user.hoursBalance - requestedHours;
        await db.updateUser(user.id, { hoursBalance: newBalance });

        const durationMs = requestedHours * 3600 * 1000;
        const expiresAt = Date.now() + durationMs;

        // Auto-shutdown timer
        const timerId = setTimeout(async () => {
            console.log(`[AutoShutdown] Student session for ${user.email} (${requestedHours} hrs) ended. Shutting down EC2...`);
            try {
                await shutdownInstance();
            } catch (err) {
                console.error('Auto shutdown error:', err);
            }
            activeSession = { isActive: false, type: 'none', userId: null, timerId: null };
        }, durationMs);

        activeSession = {
            isActive: true,
            type: 'student',
            userId: user.id,
            userEmail: user.email,
            userName: user.name,
            startedAt: Date.now(),
            expiresAt: expiresAt,
            timerId: timerId
        };

        res.json({
            success: true,
            message: `Session started for ${requestedHours} hour(s)! Auto-shutdown scheduled.`,
            publicIp: newIp,
            expiresAt: expiresAt,
            remainingHoursBalance: newBalance
        });
    } catch (err) {
        console.error('Student start error:', err);
        res.status(500).json({ error: err.message || 'Failed to start session' });
    }
});

// Stop Student Session Early
app.post('/api/student/stop-session', authenticateToken, requireStudent, async (req, res) => {
    try {
        if (activeSession.timerId) clearTimeout(activeSession.timerId);
        await shutdownInstance();
        activeSession = { isActive: false, type: 'none', userId: null, timerId: null };

        res.json({
            success: true,
            message: 'Session ended early. Instance stopped to preserve cloud credits.'
        });
    } catch (err) {
        console.error('Student stop error:', err);
        res.status(500).json({ error: err.message || 'Failed to stop session' });
    }
});

// ==========================================
// 5. OWNER / ADMIN PRIVATE CONTROL
// ==========================================

// Owner Start: UNLIMITED TIME
app.post('/api/owner/start', authenticateToken, requireOwner, async (req, res) => {
    try {
        if (activeSession.timerId) clearTimeout(activeSession.timerId);
        const newIp = await bootInstance();

        activeSession = {
            isActive: true,
            type: 'owner',
            userId: 'owner',
            userEmail: OWNER_USERNAME + '@clouddesk.local',
            userName: 'Owner (Unlimited)',
            startedAt: Date.now(),
            expiresAt: null, // Unlimited!
            timerId: null
        };

        res.json({
            success: true,
            message: 'Owner session started (Unlimited time, no timers)',
            publicIp: newIp
        });
    } catch (err) {
        console.error('Owner start error:', err);
        res.status(500).json({ error: err.message || err.toString() });
    }
});

// Owner Stop
app.post('/api/owner/stop', authenticateToken, requireOwner, async (req, res) => {
    try {
        if (activeSession.timerId) clearTimeout(activeSession.timerId);
        await shutdownInstance();
        activeSession = { isActive: false, type: 'none', userId: null, timerId: null };

        res.json({
            success: true,
            message: 'Workstation stopped. Compute billing paused!'
        });
    } catch (err) {
        console.error('Owner stop error:', err);
        res.status(500).json({ error: err.message || err.toString() });
    }
});

// Owner Analytics & Data
app.get('/api/owner/analytics', authenticateToken, requireOwner, async (req, res) => {
    const users = await db.getUsers();
    const orders = await db.getOrders();
    const passes = await db.getPasses();
    const awsAccounts = await db.getAwsAccounts();

    const completedOrders = orders.filter(o => o.status === 'completed');
    const totalRevenueInr = completedOrders.reduce((acc, curr) => acc + (curr.amountInr || 0), 0);

    res.json({
        stats: {
            totalStudents: users.length,
            totalOrders: completedOrders.length,
            totalRevenueInr: totalRevenueInr,
            dbProvider: db.isSupabaseConfigured ? 'supabase' : 'local_json',
            activeAwsNodes: awsAccounts.length,
            activeSession: {
                isActive: activeSession.isActive,
                type: activeSession.type,
                userName: activeSession.userName,
                expiresAt: activeSession.expiresAt
            }
        },
        recentOrders: orders.slice(-10).reverse(),
        passes: passes,
        awsAccounts: awsAccounts.map(a => ({
            id: a.id,
            label: a.label,
            region: a.region,
            status: a.status,
            isActive: a.id === activeAccountId
        }))
    });
});

// Owner Generate Pass Code
app.post('/api/owner/generate-pass', authenticateToken, requireOwner, async (req, res) => {
    const { hours = 2, label = 'Student Pass' } = req.body;
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `PASS-${hours}H-${randomSuffix}`;

    const newPass = await db.createPass({
        code: code,
        hours: parseInt(hours),
        used: false,
        label: label,
        createdAt: new Date().toISOString()
    });

    res.json({
        success: true,
        code: newPass.code,
        hours: newPass.hours,
        label: newPass.label
    });
});

// ==========================================
// 6. AWS MULTI-ACCOUNT POOL (LEARNER LABS)
// ==========================================

// Get All AWS Accounts
app.get('/api/owner/aws-accounts', authenticateToken, requireOwner, async (req, res) => {
    const accounts = await db.getAwsAccounts();
    res.json({
        accounts: accounts.map(a => ({
            id: a.id,
            label: a.label,
            region: a.region,
            status: a.status,
            isActive: a.id === activeAccountId,
            hasToken: Boolean(a.sessionToken),
            expiresAt: a.expiresAt,
            createdAt: a.createdAt
        })),
        activeAccountId: activeAccountId
    });
});

// Add / Update AWS Account from Learner Lab Credentials Block
app.post('/api/owner/aws-accounts', authenticateToken, requireOwner, async (req, res) => {
    try {
        const { label, credentialsText, accessKeyId, secretAccessKey, sessionToken, region = 'us-east-1', instanceTag } = req.body;

        let parsedAccessKey = accessKeyId;
        let parsedSecretKey = secretAccessKey;
        let parsedToken = sessionToken;

        // Auto-parse if pasted as raw credentials block from AWS Learner Lab
        if (credentialsText) {
            const keyMatch = credentialsText.match(/aws_access_key_id\s*=\s*([^\s\r\n]+)/i);
            const secretMatch = credentialsText.match(/aws_secret_access_key\s*=\s*([^\s\r\n]+)/i);
            const tokenMatch = credentialsText.match(/aws_session_token\s*=\s*([^\s\r\n]+)/i);

            if (keyMatch) parsedAccessKey = keyMatch[1];
            if (secretMatch) parsedSecretKey = secretMatch[1];
            if (tokenMatch) parsedToken = tokenMatch[1];
        }

        if (!parsedAccessKey || !parsedSecretKey) {
            return res.status(400).json({ error: 'AWS Access Key ID and Secret Access Key are required' });
        }

        const account = await db.saveAwsAccount({
            label: label || `Learner Lab Node (${parsedAccessKey.slice(-4)})`,
            accessKeyId: cleanCred(parsedAccessKey),
            secretAccessKey: cleanCred(parsedSecretKey),
            sessionToken: cleanCred(parsedToken),
            region: region,
            instanceTag: instanceTag || INSTANCE_TAG,
            status: 'idle',
            expiresAt: new Date(Date.now() + 4 * 3600 * 1000).toISOString()
        });

        if (!activeAccountId) {
            activeAccountId = account.id;
        }

        res.json({
            success: true,
            message: `AWS Account node "${account.label}" saved to pool!`,
            account: { id: account.id, label: account.label }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Switch Active AWS Node
app.post('/api/owner/aws-accounts/set-active/:id', authenticateToken, requireOwner, async (req, res) => {
    const { id } = req.params;
    const accounts = await db.getAwsAccounts();
    const target = accounts.find(a => a.id === id);
    if (!target) return res.status(404).json({ error: 'AWS account not found' });

    activeAccountId = id;
    res.json({ success: true, message: `Switched active workstation node to "${target.label}"` });
});

// Remove Account from Pool
app.delete('/api/owner/aws-accounts/:id', authenticateToken, requireOwner, async (req, res) => {
    await db.deleteAwsAccount(req.params.id);
    if (activeAccountId === req.params.id) {
        activeAccountId = null;
    }
    res.json({ success: true, message: 'Account removed from pool' });
});

// Database & System Status Endpoint
app.get('/api/db/status', (req, res) => {
    res.json({
        provider: db.isSupabaseConfigured ? 'supabase' : 'local_json',
        isCloudPersistent: db.isSupabaseConfigured
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CloudDesk Platform server running at http://localhost:${PORT}`);
    console.log(`Default Owner Login: Username: ${OWNER_USERNAME} | Password: ${OWNER_PASSWORD}`);
});
