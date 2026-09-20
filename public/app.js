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
    await fetchDbStatus();
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

    const awsAlert = document.getElementById('awsCredentialsAlert');
    if (awsAlert) {
        const isAuthError = data.error && (
            data.error.includes('not authorized') ||
            data.error.includes('voc-cancel-cred') ||
            data.error.includes('AuthFailure') ||
            data.error.includes('InvalidClientTokenId')
        );
        if (isAuthError) {
            awsAlert.classList.remove('hidden');
        } else {
            awsAlert.classList.add('hidden');
        }
    }

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
// RAZORPAY STANDARD WEB CHECKOUT
// ==========================================

async function initiatePurchase(planId) {
    if (!currentUser) {
        showToast('Please sign in to buy hours');
        openStudentAuthModal('login');
        return;
    }

    showToast('Creating Razorpay order...');

    try {
        const res = await fetch('/api/create-order', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ planId: planId })
        });
        const orderData = await res.json();
        if (!res.ok) throw new Error(orderData.error || 'Failed to create order');

        // Check if Razorpay script is loaded
        if (typeof Razorpay === 'undefined') {
            throw new Error('Razorpay Checkout SDK is loading, please try again in a moment');
        }

        // Configure Razorpay Standard Checkout Options
        const options = {
            key: orderData.key_id,
            amount: orderData.amount, // in paise
            currency: orderData.currency || 'INR',
            name: 'CloudDesk OS',
            description: `Workstation Pass (${orderData.amount / 100} INR)`,
            image: 'https://cdn-icons-png.flaticon.com/512/906/906324.png',
            order_id: orderData.order_id,
            handler: async function (response) {
                showToast('Verifying payment signature with server...');
                try {
                    // Send razorpay_payment_id, razorpay_order_id, razorpay_signature to backend
                    const verifyRes = await fetch('/api/verify-payment', {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${getToken()}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature,
                            planId: planId
                        })
                    });

                    const verifyResult = await verifyRes.json();
                    if (verifyResult.success) {
                        showToast(verifyResult.message || 'Payment Successful! Hours credited.');
                        await checkAuth();
                        await fetchEc2Status();
                    } else {
                        showToast('Verification Failed: ' + (verifyResult.message || 'Signature mismatch'));
                    }
                } catch (verifyErr) {
                    console.error('Verify error:', verifyErr);
                    showToast('Payment verification network error: ' + verifyErr.message);
                }
            },
            prefill: {
                name: currentUser ? currentUser.name : '',
                email: currentUser ? currentUser.email : '',
                contact: (currentUser && currentUser.phone) || '9637843011'
            },
            notes: {
                planId: planId,
                userId: currentUser ? currentUser.id : ''
            },
            theme: {
                color: '#10b981'
            },
            modal: {
                ondismiss: function () {
                    showToast('Payment cancelled by user');
                }
            }
        };

        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (response) {
            console.error('Payment Failed:', response.error);
            showToast('Payment failed: ' + (response.error.description || response.error.reason));
        });
        rzp.open();

    } catch (err) {
        console.error('Checkout error:', err);
        showToast('Checkout Error: ' + err.message);
    }
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

        // Also refresh AWS nodes and DB status for owner
        fetchAwsAccounts();
        fetchDbStatus();
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
// AWS MULTI-ACCOUNT NODE POOL (LEARNER LABS)
// ==========================================

async function fetchDbStatus() {
    try {
        const res = await fetch('/api/db/status');
        if (!res.ok) return;
        const data = await res.json();
        const badge = document.getElementById('dbProviderBadge');
        if (!badge) return;

        if (data.provider === 'supabase') {
            badge.className = 'text-[10px] px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono border border-emerald-500/30';
            badge.innerHTML = '<i class="fa-solid fa-cloud text-emerald-400 mr-1"></i>DB: Supabase (Persistent)';
        } else {
            badge.className = 'text-[10px] px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-mono border border-amber-500/30';
            badge.innerHTML = '<i class="fa-solid fa-database text-amber-400 mr-1"></i>DB: Local JSON (Fallback)';
        }
    } catch (e) {
        console.error('DB status check error:', e);
    }
}

async function fetchAwsAccounts() {
    const token = getToken();
    if (!token || !currentUser || currentUser.role !== 'owner') return;

    try {
        const res = await fetch('/api/owner/aws-accounts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        renderAwsAccountsList(data.accounts, data.activeAccountId);
    } catch (e) {
        console.error('Error fetching AWS accounts:', e);
    }
}

function renderAwsAccountsList(accounts = [], activeAccountId = null) {
    const container = document.getElementById('awsAccountsList');
    if (!container) return;

    if (!accounts || accounts.length === 0) {
        container.innerHTML = `
            <div class="p-6 rounded-xl bg-slate-900/60 border border-dashed border-slate-800 text-center space-y-2.5">
                <div class="w-10 h-10 rounded-xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto text-base">
                    <i class="fa-brands fa-aws"></i>
                </div>
                <h5 class="text-xs font-semibold text-slate-300">No AWS Learner Lab Accounts in Pool</h5>
                <p class="text-[11px] text-slate-500 max-w-sm mx-auto">
                    Learner Labs expire every 4 hours. Add 1, 2, or more accounts to switch nodes instantly with zero downtime.
                </p>
                <button onclick="toggleAddAwsAccountModal(true)" class="px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition inline-flex items-center space-x-1.5">
                    <i class="fa-solid fa-plus text-[10px]"></i>
                    <span>Add First Node</span>
                </button>
            </div>
        `;
        return;
    }

    let html = '';
    accounts.forEach(acc => {
        const isActive = acc.isActive;
        const hasToken = acc.hasToken;

        html += `
            <div class="p-4 rounded-xl ${isActive ? 'bg-indigo-950/40 border-indigo-500/50 shadow-lg shadow-indigo-950/30' : 'bg-slate-900/60 border-slate-800'} border flex flex-wrap items-center justify-between gap-3 transition">
                <div class="flex items-center space-x-3 min-w-[220px]">
                    <div class="w-9 h-9 rounded-xl ${isActive ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-800 text-slate-400'} flex items-center justify-center text-sm font-bold">
                        <i class="fa-brands fa-aws"></i>
                    </div>
                    <div>
                        <div class="flex items-center space-x-2">
                            <h5 class="text-xs font-bold text-white">${acc.label}</h5>
                            ${isActive ? '<span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-semibold uppercase tracking-wider">Serving Active Workstation</span>' : ''}
                        </div>
                        <p class="text-[11px] text-slate-400 mt-0.5 flex items-center space-x-2 font-mono">
                            <span>${acc.region}</span>
                            <span>&bull;</span>
                            <span>${hasToken ? 'Learner Lab Session Token' : 'IAM User'}</span>
                        </p>
                    </div>
                </div>

                <div class="flex items-center space-x-2">
                    ${!isActive ? `
                        <button onclick="setActiveAwsAccount('${acc.id}')" class="px-3 py-1.5 rounded-lg bg-indigo-600/80 hover:bg-indigo-600 text-white text-[11px] font-semibold transition flex items-center space-x-1.5 shadow">
                            <i class="fa-solid fa-arrows-rotate text-[10px]"></i>
                            <span>Set as Active Node</span>
                        </button>
                    ` : `
                        <span class="text-[11px] text-emerald-400 font-semibold flex items-center space-x-1.5 px-3 py-1.5 bg-emerald-500/10 rounded-lg border border-emerald-500/20">
                            <i class="fa-solid fa-circle-check"></i>
                            <span>Active Route</span>
                        </span>
                    `}
                    <button onclick="deleteAwsAccount('${acc.id}', '${acc.label.replace(/'/g, "\\'")}')" class="p-2 text-slate-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition" title="Remove node">
                        <i class="fa-regular fa-trash-can text-xs"></i>
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

async function handleAddAwsAccount(e) {
    e.preventDefault();
    const submitBtn = document.getElementById('addAwsAccountSubmitBtn');
    const label = document.getElementById('awsAccountLabelInput').value.trim();
    const credentialsText = document.getElementById('awsAccountCredentialsInput').value.trim();
    const region = document.getElementById('awsAccountRegionInput').value;
    const instanceTag = document.getElementById('awsAccountTagInput').value.trim() || 'CloudDesktop';

    if (!credentialsText) {
        showToast('Please paste the AWS credentials block');
        return;
    }

    submitBtn.disabled = true;
    submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i><span>Saving Node...</span>`;

    try {
        const res = await fetch('/api/owner/aws-accounts', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${getToken()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ label, credentialsText, region, instanceTag })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to save AWS account');

        showToast(data.message || 'AWS Node added to pool!');
        document.getElementById('awsAccountLabelInput').value = '';
        document.getElementById('awsAccountCredentialsInput').value = '';
        toggleAddAwsAccountModal(false);
        await fetchAwsAccounts();
        await fetchEc2Status();
    } catch (err) {
        showToast('Error: ' + err.message);
    } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = `<i class="fa-solid fa-plus"></i><span>Save Node to Pool</span>`;
    }
}

async function setActiveAwsAccount(id) {
    showToast('Switching active AWS node...');
    try {
        const res = await fetch(`/api/owner/aws-accounts/set-active/${id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to switch node');

        showToast(data.message || 'Switched active node');
        await fetchAwsAccounts();
        await fetchEc2Status();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

async function deleteAwsAccount(id, label) {
    if (!confirm(`Are you sure you want to remove "${label || 'this AWS node'}" from the pool?`)) return;

    try {
        const res = await fetch(`/api/owner/aws-accounts/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${getToken()}` }
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to delete node');

        showToast(data.message || 'Account removed from pool');
        await fetchAwsAccounts();
        await fetchEc2Status();
    } catch (err) {
        showToast('Error: ' + err.message);
    }
}

function toggleAddAwsAccountModal(show = null) {
    const modal = document.getElementById('addAwsAccountModal');
    if (!modal) return;
    if (show === true) {
        modal.classList.remove('hidden');
    } else if (show === false) {
        modal.classList.add('hidden');
    } else {
        modal.classList.toggle('hidden');
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
