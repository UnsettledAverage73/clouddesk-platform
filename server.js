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

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Initialize AWS EC2 Client (picks up ENV or local ~/.aws/credentials automatically)
const ec2Client = new EC2Client({ region: REGION });

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

// API: Status
app.get('/api/status', async (req, res) => {
    const data = await getInstanceState();
    res.json(data);
});

// API: Start
app.post('/api/start', async (req, res) => {
    try {
        const info = await getInstanceState();
        if (!info.exists) {
            return res.status(404).json({ error: 'Instance not found' });
        }

        if (info.state === 'running') {
            return res.json({ message: 'Instance is already running', info });
        }

        const startCmd = new StartInstancesCommand({ InstanceIds: [info.instanceId] });
        await ec2Client.send(startCmd);

        // Poll for public IP
        let newIp = null;
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const check = await getInstanceState();
            if (check.state === 'running' && check.publicIp) {
                newIp = check.publicIp;
                break;
            }
        }

        res.json({ success: true, state: 'running', publicIp: newIp });
    } catch (err) {
        console.error('Error starting instance:', err);
        res.status(500).json({ error: err.message || err.toString() });
    }
});

// API: Stop (preserves credits)
app.post('/api/stop', async (req, res) => {
    try {
        const info = await getInstanceState();
        if (!info.exists) {
            return res.status(404).json({ error: 'Instance not found' });
        }

        if (info.state === 'stopped') {
            return res.json({ message: 'Instance is already stopped', info });
        }

        const stopCmd = new StopInstancesCommand({ InstanceIds: [info.instanceId] });
        await ec2Client.send(stopCmd);

        res.json({ success: true, message: 'Instance stop initiated. Compute billing paused!' });
    } catch (err) {
        console.error('Error stopping instance:', err);
        res.status(500).json({ error: err.message || err.toString() });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`CloudDesk Platform server running at http://localhost:${PORT}`);
});
