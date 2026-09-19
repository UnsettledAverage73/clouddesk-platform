let currentUser = null;
let currentEc2Data = null;
let currentPendingOrder = null;
let countdownInterval = null;

// Auth Token Helper
function getToken() {
    return localStorage.getItem('cloudDesk_token');
}

function setToken(token) {
    localStorage.setItem('cloudDesk_token', token);
}

function removeToken() {
    localStorage.removeItem('cloudDesk_token');
}

// Initial App Boot
async function initApp() {
    await checkAuth();
    await fetchEc2Status();
    setInterval(fetchEc2Status, 10000);
}

// Check current user profile with backend
async function checkAuth() {
    const token = getToken();
    if (!token) {
        currentUser = null;
        renderAppUI();
        return;
    }

    try {
        const res = await fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            currentUser = await res.json();
        } else {
            removeToken();
            currentUser = null;
        }
    } catch (e) {
        console.error('Auth verification error:', e);
    }
    renderAppUI();
}

// Render dynamic sections based on user role
function renderAppUI() {
    const userProfileNav = document.getElementById('userProfileNav');
    const authNavButtons = document.getElementById('authNavButtons');
    const studentBalanceBadge = document.getElementById('studentBalanceBadge');
    const ownerBadgeNav = document.getElementById('ownerBadgeNav');
    const navHoursBalance = document.getElementById('navHoursBalance');

    const ownerSection = document.getElementById('ownerSection');
    const studentSection = document.getElementById('studentSection');
    const visitorHero = document.getElementById('visitorHero');

    if (!currentUser) {
        // Visitor / Logged out state
        userProfileNav.classList.add('hidden');
        authNavButtons.classList.remove('hidden');
        ownerSection.classList.add('hidden');
        studentSection.classList.add('hidden');
        visitorHero.classList.remove('hidden');
    } else if (currentUser.role === 'owner') {
        // Owner state
        userProfileNav.classList.remove('hidden');
        authNavButtons.classList.add('hidden');
        ownerBadgeNav.classList.remove('hidden');
        studentBalanceBadge.classList.add('hidden');

        ownerSection.classList.remove('hidden');
        studentSection.classList.add('hidden');
        visitorHero.classList.add('hidden');

        fetchOwnerAnalytics();
    } else if (currentUser.role === 'student') {
        // Student state
        userProfileNav.classList.remove('hidden');
        authNavButtons.classList.add('hidden');
        ownerBadgeNav.classList.add('hidden');
        studentBalanceBadge.classList.remove('hidden');
        navHoursBalance.innerText = currentUser.hoursBalance || 0;

        ownerSection.classList.add('hidden');
        studentSection.classList.remove('hidden');
        visitorHero.classList.add('hidden');

        document.getElementById('studentBalanceLarge').innerText = `${currentUser.hoursBalance || 0} Hours`;
    }
}

// Fetch general EC2 status and session
async function fetchEc2Status() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        currentEc2Data = data;
        updateStatusUI(data);
    } catch (e) {
        console.error('Error polling status:', e);
    }
}

function updateStatusUI(data) {
    const statusBadge = document.getElementById('statusBadge');
    const ipDisplay = document.getElementById('ipDisplay');
    const studentStartBtn = document.getElementById('studentStartBtn');
    const studentStopBtn = document.getElementById('studentStopBtn');
    const studentActiveStreamBox = document.getElementById('studentActiveStreamBox');

    if (!data.exists) {
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span><span>OFFLINE</span>`;
        ipDisplay.innerText = 'None';
        studentActiveStreamBox?.classList.add('hidden');
        return;
    }

    const state = data.state.toLowerCase();
    if (state === 'running') {
        statusBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span><span>RUNNING</span>`;
        ipDisplay.innerText = data.publicIp || 'Assigning...';

        if (studentStartBtn && studentStopBtn) {
            studentStartBtn.classList.add('hidden');
            studentStopBtn.classList.remove('hidden');
        }

        if (data.session && data.session.isActive) {
            studentActiveStreamBox?.classList.remove('hidden');
            if (data.session.expiresAt) {
                startStudentCountdown(data.session.expiresAt);
            } else {
                document.getElementById('studentCountdownClock').innerText = 'Unlimited (Owner)';
            }
        }
    } else {
        statusBadge.className = 'text-xs px-2.5 py-0.5 rounded-full font-semibold inline-flex items-center space-x-1.5 bg-slate-800 text-slate-400';
        statusBadge.innerHTML = `<span class="w-2 h-2 rounded-full bg-slate-500"></span><span>STOPPED</span>`;
        ipDisplay.innerText = 'Offline';

        if (studentStartBtn && studentStopBtn) {
            studentStartBtn.classList.remove('hidden');
            studentStopBtn.classList.add('hidden');
        }
        studentActiveStreamBox?.classList.add('hidden');
        if (countdownInterval) clearInterval(countdownInterval);
    }
}

// ==========================================
// AUTHENTICATION HANDLERS
// ==========================================

async function handleOwnerLogin(e) {
    e.preventDefault();
    const username = document.getElementById('ownerUsernameInput').value.trim();
    const password = document.getElementById('ownerPasswordInput').value.trim();

    try {
        const res = await fetch('/api/auth/owner-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        setToken(data.token);
        currentUser = data.user;
        closeOwnerLoginModal();
        showToast('Welcome back, Owner!');
        renderAppUI();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

async function handleStudentLogin(e) {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value.trim();

    try {
        const res = await fetch('/api/auth/student-login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        setToken(data.token);
        currentUser = { role: 'student', ...data.user };
        closeStudentAuthModal();
        showToast(`Welcome back, ${data.user.name}!`);
        renderAppUI();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

async function handleStudentRegister(e) {
    e.preventDefault();
    const name = document.getElementById('regName').value.trim();
    const email = document.getElementById('regEmail').value.trim();
    const password = document.getElementById('regPassword').value.trim();

    try {
        const res = await fetch('/api/auth/student-register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        setToken(data.token);
        currentUser = { role: 'student', ...data.user };
        closeStudentAuthModal();
        showToast(`Account created! Welcome, ${data.user.name}!`);
        renderAppUI();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

function handleLogout() {
    removeToken();
    currentUser = null;
    showToast('Signed out successfully');
    renderAppUI();
}

// ==========================================
// STUDENT WORKSTATION SESSIONS
// ==========================================

async function studentStartSession() {
    const hours = document.getElementById('sessionDurationSelect').value;
    const btn = document.getElementById('studentStartBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin text-xs"></i><span>Booting (10s)...</span>`;
    showToast(`Deducting ${hours} hr(s) & launching cloud workstation...`);

    try {
        const res = await fetch('/api/student/start-session', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hours })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to start session');

        showToast(data.message);
        await checkAuth();
        await fetchEc2Status();
    } catch (err) {
        showToast('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-play text-xs"></i><span>Start Desktop</span>`;
    }
}

async function studentStopSession() {
    if (!confirm('Stop workstation now? Any remaining session hours are preserved.')) return;

    try {
        const res = await fetch('/api/student/stop-session', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json();
        showToast(data.message || 'Session ended');
        await fetchEc2Status();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

async function redeemPassCode() {
    const code = document.getElementById('redeemCodeInput').value.trim();
    if (!code) {
        showToast('Please enter a pass code');
        return;
    }

    try {
        const res = await fetch('/api/student/redeem-code', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ code })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        showToast(data.message);
        document.getElementById('redeemCodeInput').value = '';
        await checkAuth();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

function startStudentCountdown(expiresAt) {
    if (countdownInterval) clearInterval(countdownInterval);
    const clock = document.getElementById('studentCountdownClock');

    function tick() {
        const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
        if (diff <= 0) {
            clock.innerText = '00:00:00 (Auto-stopping)';
            clearInterval(countdownInterval);
            fetchEc2Status();
            return;
        }

        const hrs = String(Math.floor(diff / 3600)).padStart(2, '0');
        const mins = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
        const secs = String(diff % 60).padStart(2, '0');
        clock.innerText = `${hrs}:${mins}:${secs}`;
    }

    tick();
    countdownInterval = setInterval(tick, 1000);
}

// ==========================================
// PAYMENT INTEGRATION (BUY HOURS)
// ==========================================

async function initiatePurchase(planId) {
    if (!currentUser) {
        showToast('Please sign in to buy hours');
        openStudentAuthModal('login');
        return;
    }

    try {
        const res = await fetch('/api/payment/create-order', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ planId })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to initiate purchase');

        currentPendingOrder = data;

        // Open checkout modal
        document.getElementById('checkoutPlanLabel').innerText = `${data.plan.label} (${data.plan.hours} Hours)`;
        document.getElementById('checkoutAmountDisplay').innerText = `₹${data.plan.priceInr}`;
        document.getElementById('paymentModal').classList.remove('hidden');
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

async function confirmPaymentSimulation() {
    if (!currentPendingOrder) return;
    const btn = document.getElementById('confirmPayBtn');
    btn.disabled = true;
    btn.innerText = 'Verifying with UPI...';

    try {
        const res = await fetch('/api/payment/verify', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                orderId: currentPendingOrder.orderId,
                razorpayPaymentId: 'sim_pay_' + Date.now(),
                razorpaySignature: 'sim_sig'
            })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        closePaymentModal();
        showToast(data.message);
        await checkAuth();
    } catch (err) {
        showToast('Verification error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = 'Simulate Payment & Credit Hours';
    }
}

function closePaymentModal() {
    document.getElementById('paymentModal').classList.add('hidden');
    currentPendingOrder = null;
}

// ==========================================
// OWNER ACTIONS & ANALYTICS
// ==========================================

async function ownerStartInstance() {
    const btn = document.getElementById('ownerStartBtn');
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Starting...</span>`;
    showToast('Owner starting EC2 (Unlimited Time)...');

    try {
        const res = await fetch('/api/owner/start', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        showToast('Workstation started without timers!');
        await fetchEc2Status();
    } catch (err) {
        showToast('Owner Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.innerHTML = `<i class="fa-solid fa-play"></i><span>Start (Unlimited Time)</span>`;
    }
}

async function ownerStopInstance() {
    if (!confirm('Stop instance now?')) return;
    try {
        const res = await fetch('/api/owner/stop', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json();
        showToast(data.message || 'Stopped');
        await fetchEc2Status();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

async function fetchOwnerAnalytics() {
    try {
        const res = await fetch('/api/owner/analytics', {
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        if (!res.ok) return;
        const data = await res.json();

        document.getElementById('statStudents').innerText = data.stats.totalStudents || 0;
        document.getElementById('statOrders').innerText = data.stats.totalOrders || 0;
        document.getElementById('statRevenue').innerText = `₹${data.stats.totalRevenueInr || 0}`;

        if (data.stats.activeSession && data.stats.activeSession.isActive) {
            document.getElementById('statSession').innerText = `${data.stats.activeSession.userName || 'Active'}`;
        } else {
            document.getElementById('statSession').innerText = 'None';
        }
    } catch (err) {
        console.error('Analytics error:', err);
    }
}

async function generatePassCode() {
    const hours = document.getElementById('genHoursSelect').value;
    const label = document.getElementById('genLabelInput').value || `Pass (${hours}h)`;

    try {
        const res = await fetch('/api/owner/generate-pass', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ hours, label })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);

        document.getElementById('generatedCodeDisplay').innerText = data.code;
        document.getElementById('generatedPassBox').classList.remove('hidden');
        showToast(`Created Pass: ${data.code} (${hours} Hours)`);
        fetchOwnerAnalytics();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

// ==========================================
// MODAL & NAVIGATION HELPERS
// ==========================================

function openStudentAuthModal(mode = 'login') {
    switchAuthTab(mode);
    document.getElementById('studentAuthModal').classList.remove('hidden');
}

function closeStudentAuthModal() {
    document.getElementById('studentAuthModal').classList.add('hidden');
}

function switchAuthTab(mode) {
    const loginForm = document.getElementById('studentLoginForm');
    const regForm = document.getElementById('studentRegisterForm');
    const tabLoginBtn = document.getElementById('tabLoginBtn');
    const tabRegisterBtn = document.getElementById('tabRegisterBtn');

    if (mode === 'login') {
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
        tabLoginBtn.className = 'text-sm font-bold text-white border-b-2 border-emerald-500 pb-1';
        tabRegisterBtn.className = 'text-sm font-semibold text-slate-400 hover:text-white pb-1';
    } else {
        loginForm.classList.add('hidden');
        regForm.classList.remove('hidden');
        tabRegisterBtn.className = 'text-sm font-bold text-white border-b-2 border-emerald-500 pb-1';
        tabLoginBtn.className = 'text-sm font-semibold text-slate-400 hover:text-white pb-1';
    }
}

function openOwnerLoginModal() {
    document.getElementById('ownerLoginModal').classList.remove('hidden');
}

function closeOwnerLoginModal() {
    document.getElementById('ownerLoginModal').classList.add('hidden');
}

function scrollToPricing() {
    document.getElementById('pricingSection')?.scrollIntoView({ behavior: 'smooth' });
}

function openEmbeddedDesktop() {
    if (!currentEc2Data || !currentEc2Data.publicIp) {
        showToast('Instance is not running yet.');
        return;
    }
    const proto = window.location.protocol === 'https:' ? 'https:' : 'http:';
    const desktopUrl = `${proto}//${currentEc2Data.publicIp}:6080/vnc.html?autoconnect=true&resize=remote`;
    window.open(desktopUrl, '_blank');
    showToast('Opening Cloud Desktop in a new window...');
}

function copyText(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied to clipboard: ' + text);
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
    setTimeout(() => toast.classList.add('translate-y-20', 'opacity-0', 'pointer-events-none'), 3200);
}

function refreshStatus() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('fa-spin');
    fetchEc2Status().finally(() => {
        setTimeout(() => icon.classList.remove('fa-spin'), 600);
    });
}

// Start
initApp();
