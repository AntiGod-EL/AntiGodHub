// economyService.js

import { logger } from '../utils/logger.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../utils/economy.js';
import { createError, ErrorTypes } from '../utils/errorHandler.js';
import { wrapServiceClassMethods } from '../utils/serviceErrorBoundary.js';

class EconomyService {

  static DAILY_COOLDOWN = 24 * 60 * 60 * 1000;
  static WORK_COOLDOWN = 15 * 1000;
  static GAMBLE_COOLDOWN = 5 * 60 * 1000;
  static CRIME_COOLDOWN = 30 * 60 * 1000;
  static ROB_COOLDOWN = 60 * 60 * 1000;
  static MINE_COOLDOWN = 60 * 60 * 1000;
  static FISH_COOLDOWN = 45 * 60 * 1000;
  static BEG_COOLDOWN = 30 * 60 * 1000;
  
  static DAILY_AMOUNT = 1000;
  static MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

  static assertSafeBalance(value, context = {}) {
    if (!Number.isSafeInteger(value) || value < 0 || value > this.MAX_SAFE_INTEGER) {
      throw createError(
        "Status saldo tidak valid",
        ErrorTypes.VALIDATION,
        "Operasi akan membuat saldo akun tidak valid.",
        { value, ...context }
      );
    }
  }

  static async claimDaily(client, guildId, userId) {
    logger.debug(`[ECONOMY_SERVICE] claimDaily diminta`, { userId, guildId });
    
    const userData = await getEconomyData(client, guildId, userId);
    if (!userData) {
      logger.error(`[ECONOMY_SERVICE] Gagal memuat data ekonomi untuk daily`);
      throw createError(
        "Gagal memuat data ekonomi",
        ErrorTypes.DATABASE,
        "Gagal memuat data ekonomimu. Silakan coba lagi nanti.",
        { userId, guildId }
      );
    }

    const now = Date.now();
    const lastDaily = userData.lastDaily || 0;
    const remaining = lastDaily + this.DAILY_COOLDOWN - now;

    if (remaining > 0) {
      logger.warn(`[ECONOMY_SERVICE] Cooldown daily aktif`, {
        userId,
        timeRemaining: remaining
      });
      throw createError(
        "Cooldown daily aktif",
        ErrorTypes.RATE_LIMIT,
        `Kamu perlu menunggu sebelum mengklaim daily lagi. Coba lagi dalam **${this.formatDuration(remaining)}**.`,
        { remaining, cooldownType: 'daily' }
      );
    }

    const earned = this.DAILY_AMOUNT;
    const nextCash = (userData.cash || 0) + earned;
    this.assertSafeBalance(nextCash, { operation: 'claimDaily', userId, guildId });
    userData.cash = nextCash;
    userData.lastDaily = now;

    try {
      await setEconomyData(client, guildId, userId, userData);
      
      logger.info(`[ECONOMY_TRANSACTION] Daily diklaim`, {
        userId,
        guildId,
        amount: earned,
        newCash: userData.cash,
        timestamp: new Date().toISOString(),
        source: 'claim_daily'
      });

      return {
        earned,
        newCash: userData.cash,
        nextClaimTime: new Date(now + this.DAILY_COOLDOWN)
      };
    } catch (error) {
      logger.error(`[ECONOMY_SERVICE] Gagal menyimpan daily claim`, error, {
        userId,
        guildId,
        amount: earned
      });
      throw createError(
        "Gagal menyimpan daily claim",
        ErrorTypes.DATABASE,
        "Gagal memproses daily mu. Silakan coba lagi.",
        { userId, guildId }
      );
    }
  }

  static async transferMoney(client, guildId, senderId, receiverId, amount) {
    logger.debug(`[ECONOMY_SERVICE] transferMoney diminta`, {
      senderId,
      receiverId,
      amount,
      guildId
    });

    if (amount <= 0) {
      throw createError(
        "Jumlah transfer tidak valid",
        ErrorTypes.VALIDATION,
        "Jumlah harus lebih besar dari nol.",
        { amount, senderId }
      );
    }

    if (senderId === receiverId) {
      throw createError(
        "Tidak bisa membayar diri sendiri",
        ErrorTypes.VALIDATION,
        "Kamu tidak bisa membayar diri sendiri.",
        { senderId, receiverId }
      );
    }

    this.validateAmount(amount, { operation: 'transfer', senderId, receiverId });

    const [senderData, receiverData] = await Promise.all([
      getEconomyData(client, guildId, senderId),
      getEconomyData(client, guildId, receiverId)
    ]);

    if (!senderData || !receiverData) {
      logger.error(`[ECONOMY_SERVICE] Gagal memuat data ekonomi untuk transfer`, {
        senderLoaded: !!senderData,
        receiverLoaded: !!receiverData
      });
      throw createError(
        "Gagal memuat data ekonomi",
        ErrorTypes.DATABASE,
        "Gagal memuat data ekonomi. Silakan coba lagi nanti.",
        { senderId, receiverId, guildId }
      );
    }

    if (senderData.cash < amount) {
      logger.warn(`[ECONOMY_SERVICE] Dana tidak cukup untuk transfer`, {
        senderId,
        required: amount,
        available: senderData.cash
      });
      throw createError(
        "Dana tidak cukup",
        ErrorTypes.VALIDATION,
        `Kamu hanya punya **${senderData.cash.toLocaleString()}** cash.`,
        { required: amount, available: senderData.cash, senderId }
      );
    }

    const cashBefore = senderData.cash;
    const senderNext = (senderData.cash || 0) - amount;
    const receiverNext = (receiverData.cash || 0) + amount;

    this.assertSafeBalance(senderNext, { operation: 'transfer.sender', senderId, amount });
    this.assertSafeBalance(receiverNext, { operation: 'transfer.receiver', receiverId, amount });

    senderData.cash = senderNext;
    receiverData.cash = receiverNext;

    try {
      
      await setEconomyData(client, guildId, senderId, senderData);
      
      try {
        
        await setEconomyData(client, guildId, receiverId, receiverData);
      } catch (receiverError) {
        
        logger.error(`[ECONOMY_CRITICAL] Gagal mengkreditkan penerima ${receiverId}. Mencoba rollback untuk pengirim ${senderId}...`, receiverError);
        
        senderData.cash = cashBefore;
        try {
          await setEconomyData(client, guildId, senderId, senderData);
          logger.info(`[ECONOMY_ROLLBACK] Berhasil rollback pengirim ${senderId} setelah kegagalan kredit penerima.`);
        } catch (rollbackError) {
          logger.error(`[ECONOMY_FATAL] ROLLBACK GAGAL untuk pengirim ${senderId}! Data sekarang tidak konsisten.`, rollbackError);
          
        }
        
        throw receiverError;
      }

      logger.info(`[ECONOMY_TRANSACTION] Uang ditransfer`, {
        type: 'transfer',
        senderId,
        receiverId,
        guildId,
        amount,
        senderNewBalance: senderData.cash,
        receiverNewBalance: receiverData.cash,
        timestamp: new Date().toISOString()
      });

      return {
        senderNewBalance: senderData.cash,
        receiverNewBalance: receiverData.cash
      };
    } catch (error) {
      logger.error(`[ECONOMY_SERVICE] Eksekusi transfer gagal, DATA MUNGKIN TIDAK KONSISTEN`, error, {
        senderId,
        receiverId,
        amount,
        guildId,
        senderBefore: cashBefore,
        senderAfter: senderData.cash,
        receiverAfter: receiverData.cash
      });
      throw createError(
        "Gagal menyimpan transfer",
        ErrorTypes.DATABASE,
        "Gagal memproses transfer. Silakan coba lagi.",
        { senderId, receiverId, amount }
      );
    }
  }

  static async addMoney(client, guildId, userId, amount, source = 'unknown') {
    if (amount <= 0) {
      throw createError(
        "Jumlah tidak valid",
        ErrorTypes.VALIDATION,
        "Jumlah harus positif",
        { amount, userId, source }
      );
    }

    this.validateAmount(amount, { operation: 'addMoney', userId, source });

    const userData = await getEconomyData(client, guildId, userId);
    const balanceBefore = userData.cash || 0;
    const nextCash = balanceBefore + amount;
    this.assertSafeBalance(nextCash, { operation: 'addMoney', userId, source, amount });
    userData.cash = nextCash;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Uang ditambahkan`, {
      userId,
      guildId,
      amount,
      source,
      balanceBefore,
      balanceAfter: userData.cash,
      delta: amount,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static async removeMoney(client, guildId, userId, amount, reason = 'unknown') {
    if (amount <= 0) {
      throw createError(
        "Jumlah tidak valid",
        ErrorTypes.VALIDATION,
        "Jumlah harus positif",
        { amount, userId, reason }
      );
    }

    this.validateAmount(amount, { operation: 'removeMoney', userId, reason });

    const userData = await getEconomyData(client, guildId, userId);
    const balanceBefore = userData.cash || 0;

    if (balanceBefore < amount) {
      throw createError(
        "Dana tidak cukup",
        ErrorTypes.VALIDATION,
        `Kamu hanya punya **${balanceBefore.toLocaleString()}** cash.`,
        { required: amount, available: balanceBefore, reason }
      );
    }

    userData.cash = balanceBefore - amount;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Uang dihapus`, {
      userId,
      guildId,
      amount,
      reason,
      balanceBefore,
      balanceAfter: userData.cash,
      delta: -amount,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static async depositToBank(client, guildId, userId, amount) {
    this.validateAmount(amount, { operation: 'deposit', userId });

    const userData = await getEconomyData(client, guildId, userId);
    const maxBank = getMaxBankCapacity(userData);

    if (userData.cash < amount) {
      throw createError(
        "Cash tidak cukup",
        ErrorTypes.VALIDATION,
        `Kamu hanya punya **${userData.cash.toLocaleString()}** cash.`,
        { required: amount, available: userData.cash }
      );
    }

    const currentBank = userData.bank || 0;
    if (currentBank + amount > maxBank) {
      throw createError(
        "Kapasitas bank terlampaui",
        ErrorTypes.VALIDATION,
        `Bank mu hanya bisa menampung **${maxBank.toLocaleString()}**. Kamu akan melampaui kapasitas sebesar **${(currentBank + amount - maxBank).toLocaleString()}**.`,
        { capacity: maxBank, current: currentBank, requested: amount }
      );
    }

    const nextCash = userData.cash - amount;
    const nextBank = (userData.bank || 0) + amount;

    this.assertSafeBalance(nextCash, { operation: 'deposit.cash', userId, amount });
    this.assertSafeBalance(nextBank, { operation: 'deposit.bank', userId, amount });

    userData.cash = nextCash;
    userData.bank = nextBank;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Uang disimpan ke bank`, {
      userId,
      guildId,
      amount,
      cashAfter: userData.cash,
      bankAfter: userData.bank,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static async withdrawFromBank(client, guildId, userId, amount) {
    this.validateAmount(amount, { operation: 'withdraw', userId });

    const userData = await getEconomyData(client, guildId, userId);
    const bank = userData.bank || 0;

    if (bank < amount) {
      throw createError(
        "Saldo bank tidak cukup",
        ErrorTypes.VALIDATION,
        `Kamu hanya punya **${bank.toLocaleString()}** di bank mu.`,
        { required: amount, available: bank }
      );
    }

    const nextCash = (userData.cash || 0) + amount;
    const nextBank = bank - amount;

    this.assertSafeBalance(nextCash, { operation: 'withdraw.cash', userId, amount });
    this.assertSafeBalance(nextBank, { operation: 'withdraw.bank', userId, amount });

    userData.cash = nextCash;
    userData.bank = nextBank;

    await setEconomyData(client, guildId, userId, userData);

    logger.info(`[ECONOMY_TRANSACTION] Uang ditarik dari bank`, {
      userId,
      guildId,
      amount,
      cashAfter: userData.cash,
      bankAfter: userData.bank,
      timestamp: new Date().toISOString()
    });

    return userData;
  }

  static checkCooldown(userData, action, cooldownMs) {
    const lastActionField = `last${action.charAt(0).toUpperCase() + action.slice(1)}`;
    const lastTime = userData[lastActionField] || 0;
    const now = Date.now();
    const remaining = Math.max(0, lastTime + cooldownMs - now);

    return {
      isOnCooldown: remaining > 0,
      remaining,
      formatted: this.formatDuration(remaining),
      nextAvailable: new Date(lastTime + cooldownMs)
    };
  }

  static validateAmount(amount, context = {}) {
    if (!Number.isInteger(amount)) {
      throw createError(
        "Jumlah tidak valid - bukan integer",
        ErrorTypes.VALIDATION,
        "Jumlah harus bilangan bulat",
        context
      );
    }

    if (amount <= 0) {
      throw createError(
        "Jumlah tidak valid - bukan positif",
        ErrorTypes.VALIDATION,
        "Jumlah harus positif",
        context
      );
    }

    if (amount > this.MAX_SAFE_INTEGER) {
      logger.error(`[ECONOMY] Jumlah melebihi MAX_SAFE_INTEGER`, { amount, context });
      throw createError(
        "Jumlah terlalu besar",
        ErrorTypes.VALIDATION,
        "Jumlah terlalu besar untuk diproses",
        context
      );
    }
  }

  static formatDuration(ms) {
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    if (hours > 0) {
      return `${hours}j ${minutes}m ${seconds}d`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds}d`;
    }
    return `${seconds}d`;
  }

  static formatCooldownDisplay(ms) {
    const duration = this.formatDuration(ms);
    return `**${duration}**`;
  }
}

wrapServiceClassMethods(EconomyService, (methodName) => ({
  service: 'EconomyService',
  operation: methodName,
  message: `Operasi layanan ekonomi gagal: ${methodName}`,
  userMessage: 'Operasi ekonomi gagal. Silakan coba lagi dalam beberapa saat.'
}));

export default EconomyService;
