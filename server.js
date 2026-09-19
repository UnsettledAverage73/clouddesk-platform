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

// Initialize AWS EC2 Client
const ec2Client = new EC2Client({ region: REGION });

// Optional Razorpay Client
let razorpayClient = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    razorpayClient = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
}

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
async function getInstanceState() {
    try {
        const command = new DescribeInstancesCommand({
            Filters: [
                { Name: 'tag:Name', Values: [INSTANCE_TAG] },
                { Name: 'instance-state-name', Values: ['pending', 'running', 'shutting-down', 'stopped', 'stopping'] }
            ]
        });

        const response = await ec2Client.send(command);
        const reservation = response.Reservations && response.Reservations[0];
        const instance = reservation && reservation.Instances && reservation.Instances[0];

        if (!instance) {
            return { exists: false, status: 'not_found' };
        }

        return {
            exists: true,
            instanceId: instance.InstanceId,
            state: instance.State?.Name || 'unknown',
            publicIp: instance.PublicIpAddress || null,
            instanceType: instance.InstanceType || 't3.large',
            launchTime: instance.LaunchTime || null,
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
    const info = await getInstanceState();
    if (!info.exists) throw new Error('Instance not found');

    if (info.state !== 'running') {
        await ec2Client.send(new StartInstancesCommand({ InstanceIds: [info.instanceId] }));
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
    const info = await getInstanceState();
    if (info.exists && info.state === 'running') {
        await ec2Client.send(new StopInstancesCommand({ InstanceIds: [info.instanceId] }));
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
app.post('/api/auth/student-register', (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ error: 'Name, email, and password are required' });
    }

    if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    const existing = db.findUserByEmail(email);
    if (existing) {
        return res.status(409).json({ error: 'An account with this email already exists' });
    }

    const hashedPassword = bcrypt.hashSync(password, 10);
    const user = db.createUser({
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
app.post('/api/auth/student-login', (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = db.findUserByEmail(email);
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
        user: { id: user.id, name: user.name, email: user.email, hoursBalance: user.hoursBalance }
    });
});

// Get Current User Profile (Owner or Student)
app.get('/api/auth/me', authenticateToken, (req, res) => {
    if (req.user.role === 'owner') {
        return res.json({
            role: 'owner',
            name: 'CloudDesk Owner',
            username: OWNER_USERNAME
        });
    }

    const user = db.findUserById(req.user.id);
    if (!user) {
        return res.status(404).json({ error: 'User profile not found' });
    }

    res.json({
        role: 'student',
        id: user.id,
        name: user.name,
        email: user.email,
        hoursBalance: user.hoursBalance || 0
    });
});

// ==========================================
// 3. PAYMENT INTEGRATION (RAZORPAY & DEMO UPI)
// ==========================================

// Create Order (Prepares payment)
app.post('/api/payment/create-order', authenticateToken, requireStudent, async (req, res) => {
    const { planId } = req.body;
    const plan = PLANS[planId];

    if (!plan) {
        return res.status(400).json({ error: 'Invalid plan selected' });
    }

    const user = db.findUserById(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    try {
        if (razorpayClient) {
            // Live Razorpay Mode
            const options = {
                amount: plan.priceInr * 100, // in paise
                currency: 'INR',
                receipt: `rcpt_${Date.now()}`,
                notes: { userId: user.id, planId: plan.id, hours: plan.hours }
            };
            const rzOrder = await razorpayClient.orders.create(options);

            const order = db.createOrder({
                userId: user.id,
                userEmail: user.email,
                planId: plan.id,
                hours: plan.hours,
                amountInr: plan.priceInr,
                razorpayOrderId: rzOrder.id,
                provider: 'razorpay'
            });

            return res.json({
                success: true,
                orderId: order.id,
                razorpayOrderId: rzOrder.id,
                amount: rzOrder.amount,
                currency: 'INR',
                keyId: process.env.RAZORPAY_KEY_ID,
                plan: plan,
                mode: 'live'
            });
        } else {
            // Instant UPI / Demo Simulation Mode
            const order = db.createOrder({
                userId: user.id,
                userEmail: user.email,
                planId: plan.id,
                hours: plan.hours,
                amountInr: plan.priceInr,
                provider: 'demo_upi'
            });

            return res.json({
                success: true,
                orderId: order.id,
                amount: plan.priceInr,
                currency: 'INR',
                plan: plan,
                mode: 'demo',
                message: 'Demo UPI / Sandbox checkout mode active. You can instantly simulate payment.'
            });
        }
    } catch (err) {
        console.error('Create order error:', err);
        res.status(500).json({ error: err.message || 'Payment initiation failed' });
    }
});

// Verify & Finalize Payment (Credits Hours to Student)
app.post('/api/payment/verify', authenticateToken, requireStudent, async (req, res) => {
    const { orderId, razorpayPaymentId, razorpaySignature } = req.body;

    const orders = db.getOrders();
    const order = orders.find(o => o.id === orderId);

    if (!order) {
        return res.status(404).json({ error: 'Order not found' });
    }

    if (order.status === 'completed') {
        return res.json({ message: 'Order already completed', hoursBalance: db.findUserById(order.userId)?.hoursBalance });
    }

    try {
        if (order.provider === 'razorpay') {
            const body = order.razorpayOrderId + '|' + razorpayPaymentId;
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
                .update(body.toString())
                .digest('hex');

            if (expectedSignature !== razorpaySignature) {
                return res.status(400).json({ error: 'Invalid payment signature verification' });
            }
        }

        // Credit the student's account
        const user = db.findUserById(order.userId);
        const newBalance = (user.hoursBalance || 0) + order.hours;
        db.updateUser(user.id, { hoursBalance: newBalance });

        db.updateOrder(order.id, {
            status: 'completed',
            completedAt: new Date().toISOString(),
            paymentId: razorpayPaymentId || `sim_${Date.now()}`
        });

        res.json({
            success: true,
            message: `Payment successful! Added +${order.hours} hour(s) to your account.`,
            hoursAdded: order.hours,
            newHoursBalance: newBalance
        });
    } catch (err) {
        console.error('Payment verify error:', err);
        res.status(500).json({ error: err.message || 'Payment verification failed' });
    }
});

// Redeem Pass Code (For students who bought a code offline or in person)
app.post('/api/student/redeem-code', authenticateToken, requireStudent, (req, res) => {
    const { code } = req.body;
    if (!code) return res.status(400).json({ error: 'Code is required' });

    const cleanCode = code.trim().toUpperCase();
    const pass = db.getPasses().find(p => p.code.toUpperCase() === cleanCode);

    if (!pass) return res.status(401).json({ error: 'Invalid pass code' });
    if (pass.used) return res.status(403).json({ error: 'This pass code has already been used' });

    const user = db.findUserById(req.user.id);
    const newBalance = (user.hoursBalance || 0) + pass.hours;

    db.updateUser(user.id, { hoursBalance: newBalance });
    db.updatePass(cleanCode, { used: true, redeemedBy: user.email, redeemedAt: new Date().toISOString() });

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

    const user = db.findUserById(req.user.id);
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
        db.updateUser(user.id, { hoursBalance: newBalance });

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
app.get('/api/owner/analytics', authenticateToken, requireOwner, (req, res) => {
    const users = db.getUsers();
    const orders = db.getOrders();
    const passes = db.getPasses();

    const completedOrders = orders.filter(o => o.status === 'completed');
    const totalRevenueInr = completedOrders.reduce((acc, curr) => acc + (curr.amountInr || 0), 0);

    res.json({
        stats: {
            totalStudents: users.length,
            totalOrders: completedOrders.length,
            totalRevenueInr: totalRevenueInr,
            activeSession: {
                isActive: activeSession.isActive,
                type: activeSession.type,
                userName: activeSession.userName,
                expiresAt: activeSession.expiresAt
            }
        },
        recentOrders: orders.slice(-10).reverse(),
        passes: passes
    });
});

// Owner Generate Pass Code
app.post('/api/owner/generate-pass', authenticateToken, requireOwner, (req, res) => {
    const { hours = 2, label = 'Student Pass' } = req.body;
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `PASS-${hours}H-${randomSuffix}`;

    const newPass = db.createPass({
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

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CloudDesk Platform server running at http://localhost:${PORT}`);
    console.log(`Default Owner Login: Username: ${OWNER_USERNAME} | Password: ${OWNER_PASSWORD}`);
});
