const fs = require('fs');
const path = require('path');

const DB_DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

const USERS_FILE = path.join(DB_DIR, 'users.json');
const ORDERS_FILE = path.join(DB_DIR, 'orders.json');
const PASSES_FILE = path.join(DB_DIR, 'passes.json');

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

// Users
function getUsers() {
    return readFile(USERS_FILE, []);
}

function saveUsers(users) {
    writeFile(USERS_FILE, users);
}

function findUserByEmail(email) {
    const users = getUsers();
    return users.find(u => u.email.toLowerCase() === email.toLowerCase());
}

function findUserById(id) {
    const users = getUsers();
    return users.find(u => u.id === id);
}

function createUser(userData) {
    const users = getUsers();
    const newUser = {
        id: 'usr_' + Math.random().toString(36).substring(2, 9),
        createdAt: new Date().toISOString(),
        hoursBalance: 0,
        ...userData
    };
    users.push(newUser);
    saveUsers(users);
    return newUser;
}

function updateUser(id, updates) {
    const users = getUsers();
    const index = users.findIndex(u => u.id === id);
    if (index !== -1) {
        users[index] = { ...users[index], ...updates };
        saveUsers(users);
        return users[index];
    }
    return null;
}

// Orders / Transactions
function getOrders() {
    return readFile(ORDERS_FILE, []);
}

function createOrder(orderData) {
    const orders = getOrders();
    const order = {
        id: 'ord_' + Math.random().toString(36).substring(2, 10),
        createdAt: new Date().toISOString(),
        status: 'pending',
        ...orderData
    };
    orders.push(order);
    writeFile(ORDERS_FILE, orders);
    return order;
}

function updateOrder(id, updates) {
    const orders = getOrders();
    const index = orders.findIndex(o => o.id === id);
    if (index !== -1) {
        orders[index] = { ...orders[index], ...updates };
        writeFile(ORDERS_FILE, orders);
        return orders[index];
    }
    return null;
}

// Passes
function getPasses() {
    return readFile(PASSES_FILE, [
        { code: 'PASS1HR', hours: 1, used: false, label: '1-Hour Sprint Pass' },
        { code: 'PASS2HR', hours: 2, used: false, label: '2-Hour Assignment Pack' },
        { code: 'PASS3HR', hours: 3, used: false, label: '3-Hour Project Pack' }
    ]);
}

function createPass(passData) {
    const passes = getPasses();
    passes.push(passData);
    writeFile(PASSES_FILE, passes);
    return passData;
}

function updatePass(code, updates) {
    const passes = getPasses();
    const index = passes.findIndex(p => p.code.toUpperCase() === code.toUpperCase());
    if (index !== -1) {
        passes[index] = { ...passes[index], ...updates };
        writeFile(PASSES_FILE, passes);
        return passes[index];
    }
    return null;
}

module.exports = {
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
    updatePass
};
