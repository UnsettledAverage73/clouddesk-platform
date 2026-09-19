let currentData = null;
let countdownInterval = null;

// Check owner key in localStorage
function getOwnerKey() {
    return localStorage.getItem('cloudDesk_ownerKey') || '';
}

function isOwnerMode() {
    return !!getOwnerKey();
}

async function fetchStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        currentData = data;
        updateUI(data);
    } catch (err) {
        console.error('Error fetching status:', err);
    }
}

function updateUI(data) {
    const statusBadge = document.getElementById('statusBadge');
    const ipDisplay = document.getElementById('ipDisplay');
    const sessionTypeDisplay = document.getElementById('sessionTypeDisplay');
    const countdownDisplay = document.getElementById('countdownDisplay');
    const runningActions = document.getElementById('runningActions');
    const vncCmd = document.getElementById('vncCmd');
    const authAlertBanner = document.getElementById('authAlertBanner');
    const authErrorMsg = document.getElementById('authErrorMsg');
    const ownerControls = document.getElementById('ownerControls');
    const studentPassBox = document.getElementById('studentPassBox');
    const ownerBanner = document.getElementById('ownerBanner');
    const ownerPassGenBox = document.getElementById('ownerPassGenBox');
    const modeLabel = document.getElementById('modeLabel');

    // Handle Owner Mode UI Visibility
    if (isOwnerMode()) {
        ownerControls.classList.remove('hidden');
        ownerBanner.classList.remove('hidden');
        ownerPassGenBox.classList.remove('hidden');
        studentPassBox.classList.add('hidden');
        modeLabel.innerText = '👑 Owner Mode';
    } else {
        ownerControls.classList.add('hidden');
        ownerBanner.classList.add('hidden');
        ownerPassGenBox.classList.add('hidden');
        studentPassBox.classList.remove('hidden');
        modeLabel.innerText = 'Switch to Owner Mode';
    }

    if (data.error) {
        if (authAlertBanner) {
            authAlertBanner.classList.remove('hidden');
            if (authErrorMsg) authErrorMsg.innerText = data.error;
        }
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/30';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span><span>AWS SESSION EXPIRED</span>`;
        ipDisplay.innerText = 'Token Expired';
        runningActions.classList.add('hidden');
        return;
    } else {
        if (authAlertBanner) authAlertBanner.classList.add('hidden');
    }

    if (!data.exists) {
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span><span>NOT FOUND</span>`;
        ipDisplay.innerText = 'None';
        runningActions.classList.add('hidden');
        return;
    }

    const state = data.state.toLowerCase();
    
    if (state === 'running') {
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span>RUNNING</span>`;
        
        ipDisplay.innerText = data.publicIp || 'Assigning...';
        vncCmd.innerText = `vncviewer ${data.publicIp}:5901`;
        runningActions.classList.remove('hidden');

        // Session status
        if (data.session && data.session.isActive) {
            if (data.session.type === 'owner') {
                sessionTypeDisplay.innerText = 'Owner (Unlimited)';
                countdownDisplay.innerText = 'No Timer (Active)';
                if (countdownInterval) clearInterval(countdownInterval);
            } else if (data.session.type === 'student') {
                sessionTypeDisplay.innerText = `Student (${data.session.code})`;
                startCountdown(data.session.expiresAt);
            }
        } else {
            sessionTypeDisplay.innerText = 'Running';
            countdownDisplay.innerText = 'None';
        }
    } else if (state === 'stopped') {
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-slate-800 text-slate-400 border border-slate-700';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span><span>STOPPED (0 Credits/hr)</span>`;
        
        ipDisplay.innerText = 'Offline';
        vncCmd.innerText = `Instance stopped`;
        sessionTypeDisplay.innerText = 'Standby';
        countdownDisplay.innerText = 'Offline';
        runningActions.classList.add('hidden');
        if (countdownInterval) clearInterval(countdownInterval);
    } else {
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span><span>${state.toUpperCase()}...</span>`;
        ipDisplay.innerText = state;
    }
}

// Student Hourly Pass Redeem
async function redeemStudentPass() {
    const input = document.getElementById('passCodeInput');
    const code = input.value.trim();
    if (!code) {
        showToast('Please enter an access pass code (e.g. PASS2HR)');
        return;
    }

    const btn = document.getElementById('redeemBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Booting Workstation...</span>`;
    showToast('Validating pass & booting cloud instance...');

    try {
        const res = await fetch('/api/session/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to redeem pass');

        showToast(`Pass activated! Session duration: ${result.durationHours} hr(s)`);
        await fetchStatus();
    } catch (err) {
        showToast('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-bolt text-xs"></i><span>Start Hourly Session</span>`;
    }
}

// Owner Private Actions
async function ownerStartWorkstation() {
    const key = getOwnerKey();
    const btn = document.getElementById('ownerStartBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Starting...</span>`;
    showToast('Owner starting instance (Unlimited Time)...');

    try {
        const res = await fetch('/api/owner/start', {
            method: 'POST',
            headers: { 'x-admin-key': key }
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to start');
        showToast('Instance started with unlimited owner time!');
        await fetchStatus();
    } catch (err) {
        showToast('Owner Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-play text-xs"></i><span>Owner Start (Unlimited)</span>`;
    }
}

async function ownerStopWorkstation() {
    if (!confirm('Stop workstation now? This pauses compute billing.')) return;

    const key = getOwnerKey();
    const btn = document.getElementById('ownerStopBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Stopping...</span>`;
    showToast('Stopping instance...');

    try {
        const res = await fetch('/api/owner/stop', {
            method: 'POST',
            headers: { 'x-admin-key': key }
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Failed to stop');
        showToast('Workstation stopped! Compute charges paused.');
        await fetchStatus();
    } catch (err) {
        showToast('Owner Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-power-off text-xs"></i><span>Stop Instance</span>`;
    }
}

async function generateStudentPass() {
    const key = getOwnerKey();
    const select = document.getElementById('passHoursSelect');
    const hours = select.value;

    try {
        const res = await fetch('/api/owner/generate-pass', {
            method: 'POST',
            headers: { 'x-admin-key': key, 'Content-Type': 'application/json' },
            body: JSON.stringify({ hours: hours, label: `Pass (${hours}h)` })
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error);

        const resultBox = document.getElementById('generatedPassResult');
        const codeSpan = document.getElementById('genPassCode');
        codeSpan.innerText = result.code;
        resultBox.classList.remove('hidden');
        showToast(`Pass created: ${result.code} (${hours} Hours)`);
    } catch (err) {
        showToast('Error generating pass: ' + err.message);
    }
}

function startCountdown(expiresAt) {
    if (countdownInterval) clearInterval(countdownInterval);
    const display = document.getElementById('countdownDisplay');

    function tick() {
        const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        if (diff <= 0) {
            display.innerText = 'Expired (Auto-stopping)';
            clearInterval(countdownInterval);
            fetchStatus();
            return;
        }

        const hrs = String(Math.floor(diff / 3600)).padStart(2, '0');
        const mins = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const secs = String(diff % 60).padStart(2, '0');
        display.innerHTML = `<span class="text-amber-400 font-bold">${hrs}:${mins}:${secs}</span> <span class="text-[10px] text-slate-400">(Auto-stop)</span>`;
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
}

// Modal Handlers
function toggleOwnerModal() {
    const modal = document.getElementById('ownerModal');
    modal.classList.toggle('hidden');
    if (!modal.classList.contains('hidden')) {
        document.getElementById('ownerKeyInput').value = getOwnerKey() || 'atharva-owner-2026';
    }
}

function submitOwnerKey() {
    const key = document.getElementById('ownerKeyInput').value.trim();
    if (!key) return;
    localStorage.setItem('cloudDesk_ownerKey', key);
    toggleOwnerModal();
    showToast('Owner Mode activated!');
    fetchStatus();
}

function logoutOwner() {
    localStorage.removeItem('cloudDesk_ownerKey');
    showToast('Exited Owner Mode');
    fetchStatus();
}

function openEmbeddedDesktop() {
    if (!currentData || !currentData.publicIp) {
        showToast('Instance is not running yet.');
        return;
    }
    const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const desktopUrl = `${proto}//${currentData.publicIp}:6080/vnc.html?autoconnect=true&resize=remote`;
    window.open(desktopUrl, '_blank');
    showToast('Opening Cloud Desktop in a new window...');
}

function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied: ' + text);
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = 'fa-solid fa-check text-emerald-400';
            setTimeout(() => { icon.className = 'fa-regular fa-copy'; }, 2000);
        }
    }).catch(() => showToast('Copy failed'));
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    toastMsg.innerText = msg;
    toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none'), 3000);
}

function refreshStatus() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    fetchStatus().finally(() => {
        setTimeout(() => icon.classList.remove('fa-spin'), 600);
    });
}

fetchStatus();
setInterval(fetchStatus, 10000);
