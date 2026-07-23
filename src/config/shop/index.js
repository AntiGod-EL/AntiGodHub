import { shopItems, getItemById, getItemsByType, getItemPrice, validatePurchase } from './items.js';
import { botConfig } from '../bot.js';

const { currency } = botConfig.economy;

export const shopConfig = {
    name: 'Toko AntiGodHub',
    currency: currency.name,
    currencyName: currency.name,
    currencyNamePlural: currency.namePlural || `${currency.name}s`,
    currencySymbol: currency.symbol || '💵',
    
    categories: [
        {
            id: 'consumables',
            name: 'Konsumsi',
            description: 'Item sekali pakai yang memberikan manfaat sementara',
            icon: '🍯',
            itemTypes: ['consumable']
        },
        {
            id: 'upgrade',
            name: 'Peningkatan',
            description: 'Peningkatan permanen yang meningkatkan kemampuan Anda',
            icon: '⚡',
            itemTypes: ['upgrade']
        },
        {
            id: 'tools',
            name: 'Alat',
            description: 'Peralatan yang membantu Anda mengumpulkan sumber daya dengan lebih efisien',
            icon: '⛏️',
            itemTypes: ['tool']
        },
        {
            id: 'role',
            name: 'Peran',
            description: 'Peran khusus dengan manfaat unik',
            icon: '🎭',
            itemTypes: ['role']
        }
    ],
    
    transaction: {
        cooldown: 1000,
        maxQuantity: 99,
        confirmTimeout: 30000,
        
        refundPolicy: {
            enabled: true,
            window: 300000,
            fee: 0.1
        }
    },
    
    ui: {
        itemsPerPage: 5,
        showOutOfStock: true,
        showOwnedItems: true,
        showAffordability: true,
        
        colors: {
            primary: '#5865F2',
            success: '#43B581',
            error: '#F04747',
            warning: '#FAA61A',
            info: '#00B0F4',
            
            rarity: {
                common: '#99AAB5',
                uncommon: '#2ECC71',
                rare: '#3498DB',
                epic: '#9B59B6',
                legendary: '#F1C40F',
                mythic: '#E74C3C'
            }
        },
        
        emojis: {
            currency: '🪙',
            quantity: '✖️',
            price: '💵',
            owned: '✅',
            outOfStock: '❌',
            
            types: {
                consumable: '🍯',
                upgrade: '⚡',
                tool: '⛏️',
                role: '🎭'
            }
        }
    },
    
    events: {
        restock: {
            enabled: true,
            interval: 86400000,
            announcementChannel: null,
            message: '🛒 **Toko Diisi Ulang!** Item baru tersedia sekarang!'
        },
        
        sales: {
            enabled: true,
            schedule: [
                {
                    day: 0,
                    discount: 0.2,
                    message: '🔥 **Penjualan Akhir Pekan!** Diskon 20% untuk semua item!'
                },
            ]
        }
    }
};

export {
    shopItems,
    getItemById,
    getItemsByType,
    getItemPrice,
    validatePurchase
};

export function getCurrentPrice(itemId, { quantity = 1, userData = null } = {}) {
    const basePrice = getItemPrice(itemId) * quantity;
    
    let discount = 0;
    
    const now = new Date();
    if (shopConfig.events.sales.enabled) {
        const today = now.getDay();
        const sale = shopConfig.events.sales.schedule.find(s => s.day === today);
        if (sale) {
            discount += sale.discount;
        }
    }
    
    if (userData) {
        if (userData.roles?.includes('premium')) {
            discount += 0.1;
        }
        
        if (quantity >= 10) {
            discount += 0.1;
        }
    }
    
    discount = Math.max(0, Math.min(1, discount));
    
    return Math.floor(basePrice * (1 - discount));
}

export function getCategoryForItem(itemType) {
    return shopConfig.categories.find(cat => 
        cat.itemTypes.includes(itemType)
    ) || {
        id: 'other',
        name: 'Lainnya',
        description: 'Item lain-lain',
        icon: '📦'
    };
}

export function getItemsInCategory(categoryId) {
    const category = shopConfig.categories.find(cat => cat.id === categoryId);
    if (!category) return [];
    
    return shopItems.filter(item => 
        category.itemTypes.includes(item.type)
    );
}
