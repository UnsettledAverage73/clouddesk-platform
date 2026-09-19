const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const {
    EC2Client,
    DescribeInstancesCommand,
    StartInstancesCommand,
    StopInstancesCommand
} = require('@aws-sdk/client-ec2');

const app = express();
const PORT = process.env.PORT || 3000;
const REGION = process.env.AWS_REGION || 'us-east-1';
const INSTANCE_TAG = process.env.INSTANCE_TAG || 'AWS-Cloud-Desktop';
const ADMIN_KEY = process.env.ADMIN_KEY || 'atharva-owner-2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize AWS EC2 Client
const ec2Client = new EC2Client({ region: REGION });

// Session state tracking
let activeSession = {
    isActive: false,
    type: 'none', // 'owner' | 'student'
    code: null,
    startedAt: null,
    expiresAt: null,
    timerId: null
};

// Pass codes store (Pre-seeded with demo codes)
let passCodes = {
    'PASS1HR': { hours: 1, used: false, label: '1-Hour Sprint Pass' },
    'PASS2HR': { hours: 2, used: false, label: '2-Hour Assignment Pack' },
    'PASS3HR': { hours: 3, used: false, label: '3-Hour Project Pack' }
};

// Helper to query instance state using AWS SDK
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
            return {
                exists: false,
                status: 'not_found'
            };
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
                os: 'Ubuntu 24.04 LTS (Noble)',
                desktop: 'XFCE4'
            },
            ports: {
                webGui: 6080,
                vnc: 5901,
                rdp: 3389,
                ssh: 22
            },
            credentials: {
                user: 'ubuntu',
                password: 'LearnerLab2026!'
            }
        };
    } catch (err) {
        console.error('Error in getInstanceState:', err);
        return {
            exists: false,
            error: err.message || err.toString()
        };
    }
}

// Start instance helper
async function bootInstance() {
    const info = await getInstanceState();
    if (!info.exists) throw new Error('Instance not found');

    if (info.state !== 'running') {
        await ec2Client.send(new StartInstancesCommand({ InstanceIds: [info.instanceId] }));
    }

    // Poll for public IP
    let newIp = info.publicIp;
    for (let i = 0; i < 20; i++) {
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

// Stop instance helper
async function shutdownInstance() {
    const info = await getInstanceState();
    if (info.exists && info.state === 'running') {
        await ec2Client.send(new StopInstancesCommand({ InstanceIds: [info.instanceId] }));
    }
}

// ==========================================
// 1. PUBLIC / GENERAL API
// ==========================================

app.get('/api/status', async (req, res) => {
    const data = await getInstanceState();
    const remainingSeconds = activeSession.expiresAt ? Math.max(0, Math.floor((activeSession.expiresAt - Date.now()) / 1000)) : null;

    res.json({
        ...data,
        session: {
            isActive: activeSession.isActive,
            type: activeSession.type,
            code: activeSession.code,
            expiresAt: activeSession.expiresAt,
            remainingSeconds: remainingSeconds
        }
    });
});

// ==========================================
// 2. STUDENT / HOURLY SESSION ENDPOINT
// ==========================================

app.post('/api/session/start', async (req, res) => {
    const { code } = req.body;
    if (!code) {
        return res.status(400).json({ error: 'Access pass code is required' });
    }

    const cleanCode = code.trim().toUpperCase();
    const pass = passCodes[cleanCode];

    if (!pass) {
        return res.status(401).json({ error: 'Invalid access pass code' });
    }

    if (pass.used) {
        return res.status(403).json({ error: 'This pass code has already been redeemed' });
    }

    try {
        // Clear any previous timer
        if (activeSession.timerId) clearTimeout(activeSession.timerId);

        const newIp = await bootInstance();

        // Mark pass as used
        pass.used = true;
        const durationHours = pass.hours || 1;
        const durationMs = durationHours * 3600 * 1000;
        const expiresAt = Date.now() + durationMs;

        // Schedule auto-shutdown
        const timerId = setTimeout(async () => {
            console.log(`[AutoShutdown] Pass ${cleanCode} (${durationHours} hrs) expired. Stopping EC2 instance...`);
            try {
                await shutdownInstance();
            } catch (err) {
                console.error('Auto-shutdown failed:', err);
            }
            activeSession = { isActive: false, type: 'none', code: null, timerId: null };
        }, durationMs);

        activeSession = {
            isActive: true,
            type: 'student',
            code: cleanCode,
            startedAt: Date.now(),
            expiresAt: expiresAt,
            timerId: timerId
        };

        res.json({
            success: true,
            message: `Hourly session started for ${durationHours} hour(s)`,
            publicIp: newIp,
            durationHours: durationHours,
            expiresAt: expiresAt
        });
    } catch (err) {
        console.error('Failed to start hourly student session:', err);
        res.status(500).json({ error: err.message || err.toString() });
    }
});

// ==========================================
// 3. OWNER / ADMIN ENDPOINTS (NO RESTRICTIONS)
// ==========================================

// Middleware for Admin Key verification
function requireOwner(req, res, next) {
    const key = req.headers['x-admin-key'] || req.query.adminKey || req.body.adminKey;
    if (key !== ADMIN_KEY) {
        return res.status(401).json({ error: 'Unauthorized: Invalid Admin Key' });
    }
    next();
}

// Owner Start: UNLIMITED TIME / NO AUTO-SHUTDOWN
app.post('/api/owner/start', requireOwner, async (req, res) => {
    try {
        if (activeSession.timerId) clearTimeout(activeSession.timerId);

        const newIp = await bootInstance();

        activeSession = {
            isActive: true,
            type: 'owner',
            code: 'OWNER_MASTER',
            startedAt: Date.now(),
            expiresAt: null, // Unlimited!
            timerId: null
        };

        res.json({
            success: true,
            message: 'Owner session started (Unlimited time, no auto-shutdown)',
            publicIp: newIp
        });
    } catch (err) {
        console.error('Owner start error:', err);
        res.status(500).json({ error: err.message || err.toString() });
    }
});

// Owner Stop: Immediate shutdown
app.post('/api/owner/stop', requireOwner, async (req, res) => {
    try {
        if (activeSession.timerId) clearTimeout(activeSession.timerId);
        await shutdownInstance();
        activeSession = { isActive: false, type: 'none', code: null, timerId: null };

        res.json({
            success: true,
            message: 'Workstation stopped successfully. Compute billing paused!'
        });
    } catch (err) {
        console.error('Owner stop error:', err);
        res.status(500).json({ error: err.message || err.toString() });
    }
});

// Owner Generate Pass: Create new pass codes for paying students
app.post('/api/owner/generate-pass', requireOwner, (req, res) => {
    const { hours = 2, label = 'Student Pass' } = req.body;
    const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
    const code = `PASS-${hours}H-${randomSuffix}`;

    passCodes[code] = {
        hours: parseInt(hours),
        used: false,
        label: label,
        createdAt: new Date().toISOString()
    };

    res.json({
        success: true,
        code: code,
        hours: hours,
        label: label
    });
});

// Owner List Passes
app.get('/api/owner/passes', requireOwner, (req, res) => {
    res.json({
        passes: passCodes,
        activeSession: {
            isActive: activeSession.isActive,
            type: activeSession.type,
            code: activeSession.code,
            expiresAt: activeSession.expiresAt
        }
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CloudDesk Platform server running at http://localhost:${PORT}`);
    console.log(`Owner Admin Key: ${ADMIN_KEY}`);
});
