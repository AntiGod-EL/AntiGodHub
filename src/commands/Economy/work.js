import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { logger } from '../../utils/logger.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { botConfig } from '../../config/bot.js';

const WORK_COOLDOWN = botConfig.economy?.cooldowns?.work ?? 30 * 60 * 1000;
const MIN_WORK_AMOUNT = botConfig.economy?.workMin ?? 10;
const MAX_WORK_AMOUNT = botConfig.economy?.workMax ?? 100;
const LAPTOP_MULTIPLIER = 1.5;
const WORK_JOBS = [
    "Pengembang Perangkat Lunak",
    "Barista",
    "Tukang Kebersihan",
    "YouTuber",
    "Pengembang Bot Discord",
    "Kasir",
    "Pengantar Pizza",
    "Pustakawan",
    "Tukang Kebun",
    "Analis Data",
];

export default {
    data: new SlashCommandBuilder()
        .setName('work')
        .setDescription('Bekerja untuk mendapatkan uang'),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const now = Date.now();

            const userData = await getEconomyData(client, guildId, userId);

            if (!userData) {
                throw createError(
                    "Gagal memuat data ekonomi untuk pekerjaan",
                    ErrorTypes.DATABASE,
                    "Gagal memuat data ekonomi Anda. Silakan coba lagi nanti.",
                    { userId, guildId }
                );
            }

            logger.debug(`[ECONOMY] Perintah kerja dimulai untuk ${userId}`, { userId, guildId });

            const lastWork = userData.lastWork || 0;
            const inventory = userData.inventory || {};
            const extraWorkShifts = inventory["extra_work"] || 0;
            const hasLaptop = inventory["laptop"] || 0;

            let cooldownActive = now < lastWork + WORK_COOLDOWN;
            let usedConsumable = false;

            if (cooldownActive) {
                if (extraWorkShifts > 0) {
                    inventory["extra_work"] = (inventory["extra_work"] || 0) - 1;
                    usedConsumable = true;
                } else {
                    const remaining = lastWork + WORK_COOLDOWN - now;
                    throw createError(
                        "Cooldown pekerjaan aktif",
                        ErrorTypes.RATE_LIMIT,
                        `Anda bekerja terlalu cepat! Tunggu **${Math.floor(remaining / 3600000)}j ${Math.floor((remaining % 3600000) / 60000)}m** sebelum bekerja lagi.`,
                        { timeRemaining: remaining, cooldownType: 'work' }
                    );
                }
            }

            let earned = Math.floor(Math.random() * (MAX_WORK_AMOUNT - MIN_WORK_AMOUNT + 1)) + MIN_WORK_AMOUNT;
            const job = WORK_JOBS[Math.floor(Math.random() * WORK_JOBS.length)];

            let multiplierMessage = "";
            if (hasLaptop > 0) {
                earned = Math.floor(earned * LAPTOP_MULTIPLIER);
                multiplierMessage = "\n💻 **Bonus Laptop:** +50% penghasilan!";
            }

            userData.cash = (userData.cash || 0) + earned;
            userData.lastWork = now;

            await setEconomyData(client, guildId, userId, userData);

            logger.info(`[ECONOMY_TRANSACTION] Pekerjaan selesai`, {
                userId,
                guildId,
                amount: earned,
                job,
                usedConsumable,
                hasLaptop: hasLaptop > 0,
                newCash: userData.cash,
                timestamp: new Date().toISOString()
            });

            const embed = successEmbed(
                "💼 Pekerjaan Selesai!",
                `Anda bekerja sebagai **${job}** dan mendapatkan **Rp${earned.toLocaleString('id-ID')}**!${multiplierMessage}`
            )
                .addFields(
                    {
                        name: "Saldo Baru",
                        value: `Rp${userData.cash.toLocaleString('id-ID')}`,
                        inline: true,
                    },
                    {
                        name: "Pekerjaan Berikutnya",
                        value: `<t:${Math.floor((now + WORK_COOLDOWN) / 1000)}:R>`,
                        inline: true,
                    }
                )
                .setFooter({
                    text: `Diminta oleh ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL(),
                });

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'work' })
};
