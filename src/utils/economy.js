// economy.js

import { getColor, getEconomyKey as getEconomyStorageKey } from './database.js';
import { BotConfig } from '../config/bot.js';
import { normalizeEconomyData } from './schemas.js';
import { logger } from './logger.js';
import { validateDiscordId, validateNumber } from './validation.js';
import { DEFAULT_ECONOMY_DATA } from './constants.js';
import { createError, ErrorTypes, wrapServiceBoundary } from './errorHandler.js';

const ECONOMY_CONFIG = BotConfig.economy || {};
const BASE_BANK_CAPACITY = ECONOMY_CONFIG.baseBankCapacity || 10000;
const BANK_CAPACITY_PER_LEVEL = ECONOMY_CONFIG.bankCapacityPerLevel || 5000;
const DAILY_AMOUNT = ECONOMY_CONFIG.dailyAmount || 100;
const WORK_MIN = ECONOMY_CONFIG.workMin || 10;
const WORK_MAX = ECONOMY_CONFIG.workMax || 100;
const COOLDOWNS = ECONOMY_CONFIG.cooldowns || {
daily: 24 * 60 * 60 * 1000,
work: 15 * 1000,
crime: 30 * 60 * 1000,
rob: 60 * 60 * 1000,
};

export function getEconomyKey(guildId, userId) {
    const validGuildId = validateDiscordId(guildId, 'guildId');
    const validUserId = validateDiscordId(userId, 'userId');
    
    if (!validGuildId || !validUserId) {
        throw new Error('ID Guild atau ID pengguna tidak valid');
    }
    
    return getEconomyStorageKey(validGuildId, validUserId);
}

export function getMaxBankCapacity(userData) {
    if (!userData) return BASE_BANK_CAPACITY;
    
    const bankLevel = userData.bankLevel || 0;
    let capacity = BASE_BANK_CAPACITY + (bankLevel * BANK_CAPACITY_PER_LEVEL);

    const upgrades = userData.upgrades || {};
    const inventory = userData.inventory || {};

    if (upgrades['bank_upgrade_1']) {
        capacity = Math.floor(capacity * 1.5);
    }

    const bankNotes = inventory['bank_note'] || 0;
    capacity += (bankNotes * 10000);
    
    return capacity;
}

export function formatCurrency(amount) {
    const currencyName = ECONOMY_CONFIG.currency?.name || 'cash';
    return `${amount.toLocaleString()} ${currencyName}`;
}

export async function getEconomyData(client, guildId, userId) {
    try {
        if (!client.db || typeof client.db.get !== 'function') {
            throw new Error('Database tidak tersedia');
        }

        const key = getEconomyKey(guildId, userId);
        const data = await client.db.get(key, {});
        const defaults = {
            ...DEFAULT_ECONOMY_DATA,
            cash: ECONOMY_CONFIG.startingBalance ?? DEFAULT_ECONOMY_DATA.cash,
        };
        
        return normalizeEconomyData(data, defaults);
    } catch (error) {
        logger.error(`Kesalahan mendapatkan data ekonomi untuk pengguna ${userId}`, error);
        return normalizeEconomyData({}, DEFAULT_ECONOMY_DATA);
    }
}

export async function setEconomyData(client, guildId, userId, data) {
    try {
        if (!client.db || typeof client.db.set !== 'function') {
            throw new Error('Database tidak tersedia');
        }

        const key = getEconomyKey(guildId, userId);
        const normalized = normalizeEconomyData(data, DEFAULT_ECONOMY_DATA);
        await client.db.set(key, normalized);
        return true;
    } catch (error) {
        logger.error(`Kesalahan menyimpan data ekonomi untuk pengguna ${userId}`, error);
        return false;
    }
}

export async function updateBalance(client, guildId, userId, options = {}) {
    const data = await getEconomyData(client, guildId, userId);
    
    if (options.cash !== undefined) {
        data.cash = Math.max(0, (data.cash || 0) + options.cash);
    }
    
    if (options.bank !== undefined) {
        const maxBank = getMaxBankCapacity(data);
        data.bank = Math.min(Math.max(0, (data.bank || 0) + options.bank), maxBank);
    }
    
    if (options.xp !== undefined) {
        data.xp = Math.max(0, (data.xp || 0) + options.xp);
        
        const xpNeeded = Math.floor(5 * Math.pow(data.level || 1, 2) + 50 * (data.level || 1) + 100);
        if (data.xp >= xpNeeded) {
            data.xp -= xpNeeded;
            data.level = (data.level || 1) + 1;
            data.leveledUp = true;
        }
    }
    
    await setEconomyData(client, guildId, userId, data);
    return data;
}

export function checkCooldown(userData, action) {
    const cooldownTime = COOLDOWNS[action] || 0;
    const lastUsed = userData[`last${action.charAt(0).toUpperCase() + action.slice(1)}`] || 0;
    const now = Date.now();
    const remaining = Math.max(0, (lastUsed + cooldownTime) - now);
    
    return {
        onCooldown: remaining > 0,
        remaining,
        formatted: formatCooldown(remaining)
    };
}

function formatCooldown(ms) {
    if (ms < 1000) return 'sekarang';
    
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}h ${hours % 24}j`;
    if (hours > 0) return `${hours}j ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}d`;
    return `${seconds}d`;
}

export function getWorkReward() {
    const amount = Math.floor(Math.random() * (WORK_MAX - WORK_MIN + 1)) + WORK_MIN;
    const jobs = [
        'bekerja di restoran cepat saji',
        'bekerja sebagai programmer',
        'bekerja sebagai pekerja konstruksi',
        'bekerja sebagai dokter',
        'bekerja sebagai streamer',
        'bekerja sebagai YouTuber',
        'bekerja sebagai guru',
        'bekerja sebagai kasir',
        'bekerja sebagai kurir pengiriman',
        'bekerja sebagai freelancer'
    ];
    
    const job = jobs[Math.floor(Math.random() * jobs.length)];
    
    return {
        amount,
        job,
        message: `Kamu ${job} dan mendapatkan ${formatCurrency(amount)}!`
    };
}

export function getCrimeOutcome() {
    const outcomes = [
        {
            success: true,
            amount: Math.floor(Math.random() * 200) + 50,
            message: 'Kamu berhasil merampok bank dan kabur dengan {amount}!' 
        },
        {
            success: true,
            amount: Math.floor(Math.random() * 100) + 20,
            message: 'Kamu mencuri dompet seseorang dan mendapatkan {amount}!' 
        },
        {
            success: true,
            amount: Math.floor(Math.random() * 150) + 30,
            message: 'Kamu meretas rekening bank dan mentransfer {amount} untuk dirimu sendiri!' 
        },
        {
            success: false,
            fine: Math.floor(Math.random() * 100) + 50,
            message: 'Kamu tertangkap dan harus membayar denda {fine}!' 
        },
        {
            success: false,
            fine: Math.floor(Math.random() * 150) + 50,
            message: 'Polisi menangkapmu! Kamu membayar {fine} untuk keluar dari penjara.' 
        },
        {
            success: false,
            fine: 0,
            message: 'Usahamu gagal, tapi kamu berhasil melarikan diri!' 
        }
    ];
    
    return outcomes[Math.floor(Math.random() * outcomes.length)];
}

export function getRobOutcome(targetBalance) {
    if (targetBalance <= 0) {
        return {
            success: false,
            amount: 0,
            message: 'Target tidak memiliki uang untuk dicuri!'
        };
    }
    
const success = Math.random() > 0.4;
    
    if (success) {
        const amount = Math.min(
Math.floor(Math.random() * (targetBalance * 0.3)) + 1,
            targetBalance
        );
        
        return {
            success: true,
            amount,
            message: `Kamu berhasil merampok mereka dan kabur dengan {amount}!`
        };
    } else {
        const fine = Math.floor(Math.random() * 200) + 100;
        
        return {
            success: false,
            amount: 0,
            fine,
            message: `Kamu tertangkap! Kamu harus membayar denda {fine}.`
        };
    }
}

export function formatShopItem(item, index) {
    return `**${index + 1}.** ${item.emoji} **${item.name}** - ${formatCurrency(item.price)}\n${item.description}\n`;
}

export const addMoney = wrapServiceBoundary(async function addMoney(client, guildId, userId, amount, type = 'cash') {
    const validAmount = validateNumber(amount, 'amount');
    if (validAmount === null || validAmount <= 0) {
        throw createError(
            'Jumlah tidak valid',
            ErrorTypes.VALIDATION,
            'Jumlah harus berupa angka positif.',
            { guildId, userId, amount, operation: 'addMoney' }
        );
    }

    if (type !== 'cash' && type !== 'bank') {
        throw createError(
            'Jenis uang tidak valid',
            ErrorTypes.VALIDATION,
            'Tipe harus "cash" atau "bank".',
            { guildId, userId, type, operation: 'addMoney' }
        );
    }

    const userData = await getEconomyData(client, guildId, userId);

    if (type === 'bank') {
        const maxBank = getMaxBankCapacity(userData);
        if ((userData.bank || 0) + validAmount > maxBank) {
            throw createError(
                'Kapasitas bank terlampaui',
                ErrorTypes.VALIDATION,
                `Kapasitas bank terlampaui. Saat ini: ${userData.bank || 0}, Maksimal: ${maxBank}.`,
                { guildId, userId, current: userData.bank || 0, max: maxBank, operation: 'addMoney' }
            );
        }
        userData.bank = (userData.bank || 0) + validAmount;
    } else {
        userData.cash = (userData.cash || 0) + validAmount;
    }

    await setEconomyData(client, guildId, userId, userData);

    return {
        newBalance: type === 'bank' ? userData.bank : userData.cash,
        ...(type === 'bank' ? { maxBank: getMaxBankCapacity(userData) } : {}),
    };
}, {
    service: 'economy',
    operation: 'addMoney',
    userMessage: 'Gagal menambahkan uang. Silakan coba lagi.',
});

export const removeMoney = wrapServiceBoundary(async function removeMoney(client, guildId, userId, amount, type = 'cash') {
    const validAmount = validateNumber(amount, 'amount');
    if (validAmount === null || validAmount <= 0) {
        throw createError(
            'Jumlah tidak valid',
            ErrorTypes.VALIDATION,
            'Jumlah harus berupa angka positif.',
            { guildId, userId, amount, operation: 'removeMoney' }
        );
    }

    if (type !== 'cash' && type !== 'bank') {
        throw createError(
            'Jenis uang tidak valid',
            ErrorTypes.VALIDATION,
            'Tipe harus "cash" atau "bank".',
            { guildId, userId, type, operation: 'removeMoney' }
        );
    }

    const userData = await getEconomyData(client, guildId, userId);

    if (type === 'bank') {
        if ((userData.bank || 0) < validAmount) {
            throw createError(
                'Dana bank tidak cukup',
                ErrorTypes.VALIDATION,
                `Dana bank tidak cukup. Kamu punya ${userData.bank || 0}, butuh ${validAmount}.`,
                { guildId, userId, current: userData.bank || 0, required: validAmount, operation: 'removeMoney' }
            );
        }
        userData.bank = (userData.bank || 0) - validAmount;
    } else {
        if ((userData.cash || 0) < validAmount) {
            throw createError(
                'Dana cash tidak cukup',
                ErrorTypes.VALIDATION,
                `Dana cash tidak cukup. Kamu punya ${userData.cash || 0}, butuh ${validAmount}.`,
                { guildId, userId, current: userData.cash || 0, required: validAmount, operation: 'removeMoney' }
            );
        }
        userData.cash = (userData.cash || 0) - validAmount;
    }

    await setEconomyData(client, guildId, userId, userData);

    return {
        newBalance: type === 'bank' ? userData.bank : userData.cash,
    };
}, {
    service: 'economy',
    operation: 'removeMoney',
    userMessage: 'Gagal menghapus uang. Silakan coba lagi.',
});

export function getShopInventory() {
    return [
        {
            id: 'fishing_rod',
            name: 'Pancing',
            emoji: '🎣',
            price: 500,
            description: 'Menangkap ikan untuk dijual dengan menguntungkan!',
            type: 'tool'
        },
        {
            id: 'hunting_rifle',
            name: 'Senapan Berburu',
            emoji: '🔫',
            price: 1000,
            description: 'Berburu hewan untuk daging dan bulu!',
            type: 'tool'
        },
        {
            id: 'laptop',
            name: 'Laptop',
            emoji: '💻',
            price: 2000,
            description: 'Bekerja sebagai programmer dengan gaji lebih tinggi!',
            type: 'tool',
            workMultiplier: 1.5
        },
        {
            id: 'bank_loan',
            name: 'Pinjaman Bank',
            emoji: '🏦',
            price: 5000,
            description: 'Meningkatkan kapasitas bank kamu sebesar 50.000!',
            type: 'upgrade',
            effect: 'bank_capacity',
            value: 50000
        },
        {
            id: 'lottery_ticket',
            name: 'Tiket Lotere',
            emoji: '🎫',
            price: 100,
            description: 'Kesempatan untuk menang besar!',
            type: 'consumable',
            use: 'gamble'
        }
    ];
}
