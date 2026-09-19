let currentData = null;

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
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');
    const runningActions = document.getElementById('runningActions');
    const vncCmd = document.getElementById('vncCmd');

    const authAlertBanner = document.getElementById('authAlertBanner');
    const authErrorMsg = document.getElementById('authErrorMsg');

    if (data.error) {
        if (authAlertBanner) {
            authAlertBanner.classList.remove('hidden');
            if (authErrorMsg) authErrorMsg.innerText = data.error;
        }
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/30';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-rose-400 animate-pulse"></span><span>AWS SESSION EXPIRED</span>`;
        ipDisplay.innerText = 'Token Expired';
        startBtn.classList.add('hidden');
        stopBtn.classList.add('hidden');
        runningActions.classList.add('hidden');
        return;
    } else {
        if (authAlertBanner) authAlertBanner.classList.add('hidden');
    }

    if (!data.exists) {
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span><span>NOT FOUND</span>`;
        ipDisplay.innerText = 'None';
        startBtn.classList.add('hidden');
        stopBtn.classList.add('hidden');
        runningActions.classList.add('hidden');
        return;
    }

    const state = data.state.toLowerCase();
    
    if (state === 'running') {
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span>RUNNING</span>`;
        
        ipDisplay.innerText = data.publicIp || 'Assigning...';
        vncCmd.innerText = `vncviewer ${data.publicIp}:5901`;

        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        runningActions.classList.remove('hidden');
    } else if (state === 'stopped') {
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-slate-800 text-slate-400 border border-slate-700';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span><span>STOPPED (0 Credits/hr)</span>`;
        
        ipDisplay.innerText = 'Offline';
        vncCmd.innerText = `Instance stopped`;

        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
        runningActions.classList.add('hidden');
        closeEmbeddedDesktop();
    } else {
        // Pending / stopping
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-amber-500/10 text-amber-400 border border-amber-500/30';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span><span>${state.toUpperCase()}...</span>`;
        
        ipDisplay.innerText = state;
        startBtn.classList.add('hidden');
        stopBtn.classList.add('hidden');
    }
}

async function startWorkstation() {
    const startBtn = document.getElementById('startBtn');
    startBtn.disabled = true;
    startBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Starting (10-15s)...</span>`;
    showToast('Requesting AWS to start instance...');

    try {
        const res = await fetch('/api/start', { method: 'POST' });
        const result = await res.json();
        showToast('Instance is now running!');
        await fetchStatus();
    } catch (err) {
        showToast('Failed to start instance: ' + err.message);
    } finally {
        startBtn.disabled = false;
        startBtn.innerHTML = `<i class="fa-solid fa-play text-xs"></i><span>Start Desktop</span>`;
    }
}

async function stopWorkstation() {
    if (!confirm('Are you sure you want to stop this workstation? This will pause compute charges and preserve your AWS Learner Lab credits.')) {
        return;
    }

    const stopBtn = document.getElementById('stopBtn');
    stopBtn.disabled = true;
    stopBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Stopping...</span>`;
    showToast('Stopping instance to preserve credits...');

    try {
        const res = await fetch('/api/stop', { method: 'POST' });
        const result = await res.json();
        showToast('Workstation stopped! Compute billing paused.');
        await fetchStatus();
    } catch (err) {
        showToast('Failed to stop instance: ' + err.message);
    } finally {
        stopBtn.disabled = false;
        stopBtn.innerHTML = `<i class="fa-solid fa-power-off text-xs"></i><span>Stop & Save Credits</span>`;
    }
}

function openEmbeddedDesktop() {
    if (!currentData || !currentData.publicIp) {
        showToast('Instance is not running yet.');
        return;
    }

    const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const desktopUrl = `${proto}//${currentData.publicIp}:6080/vnc.html?autoconnect=true&resize=remote`;

    // Always open directly in a new tab to bypass browser mixed-content iframe blocks
    window.open(desktopUrl, '_blank');
    showToast('Opening Cloud Desktop in a new window...');

    // Also load into embedded container if user wants to view inline
    const container = document.getElementById('desktopContainer');
    const iframe = document.getElementById('desktopIframe');
    if (container && iframe) {
        container.classList.remove('hidden');
        iframe.src = desktopUrl;
    }
}

function closeEmbeddedDesktop() {
    const container = document.getElementById('desktopContainer');
    const iframe = document.getElementById('desktopIframe');
    iframe.src = '';
    container.classList.add('hidden');
}

function toggleFullscreen() {
    const iframe = document.getElementById('desktopIframe');
    if (iframe.requestFullscreen) {
        iframe.requestFullscreen();
    } else if (iframe.webkitRequestFullscreen) {
        iframe.webkitRequestFullscreen();
    }
}

function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard: ' + text);
        const icon = btn.querySelector('i');
        if (icon) {
            icon.className = 'fa-solid fa-check text-emerald-400';
            setTimeout(() => {
                icon.className = 'fa-regular fa-copy';
            }, 2000);
        }
    }).catch(err => {
        showToast('Copy failed, please copy manually');
    });
}

function showToast(msg) {
    const toast = document.getElementById('toast');
    const toastMsg = document.getElementById('toastMsg');
    toastMsg.innerText = msg;
    toast.classList.remove('translate-y-20', 'opacity-0', 'pointer-events-none');
    setTimeout(() => {
        toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none');
    }, 3000);
}

function refreshStatus() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    fetchStatus().finally(() => {
        setTimeout(() => icon.classList.remove('fa-spin'), 600);
    });
}

// Initial fetch & poll every 10 seconds
fetchStatus();
setInterval(fetchStatus, 10000);
