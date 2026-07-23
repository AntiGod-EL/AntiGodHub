import { SlashCommandBuilder } from 'discord.js';
import { successEmbed, warningEmbed, buildUserErrorEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';
import { BotConfig } from '../../config/bot.js';

const ROB_COOLDOWN = BotConfig.economy?.cooldowns?.rob ?? 4 * 60 * 60 * 1000;
const BASE_ROB_SUCCESS_CHANCE = BotConfig.economy?.robSuccessRate ?? 0.4;
const ROB_PERCENTAGE = 0.15;
const FINE_PERCENTAGE = 0.1;

export default {
    data: new SlashCommandBuilder()
        .setName('rob')
        .setDescription('Coba merampok pengguna lain (sangat berisiko)')
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('Pengguna yang akan dirampok')
                .setRequired(true)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        const deferred = await InteractionHelper.safeDefer(interaction);
        if (!deferred) return;
            
            const robberId = interaction.user.id;
            const victimUser = interaction.options.getUser("user");
            const guildId = interaction.guildId;
            const now = Date.now();

            if (robberId === victimUser.id) {
                throw createError(
                    "Gila Mau Ngerampok Diri Sendiri",
                    ErrorTypes.VALIDATION,
                    "Cari Target Dulu Oon",
                    { robberId, victimId: victimUser.id }
                );
            }
            
            if (victimUser.bot) {
                throw createError(
                    "Makin Gila Mau Ngerampok Bot",
                    ErrorTypes.VALIDATION,
                    "Cari Orang Oon Kalo Gabisa Mati Aja",
                    { victimId: victimUser.id, isBot: true }
                );
            }

            const robberData = await getEconomyData(client, guildId, robberId);
            const victimData = await getEconomyData(client, guildId, victimUser.id);
            
            if (!robberData || !victimData) {
                throw createError(
                    "Gaada Duit Miskin Dia",
                    ErrorTypes.DATABASE,
                    "Ganti Target",
                    { robberId: !!robberData, victimId: !!victimData, guildId }
                );
            }
            
            const lastRob = robberData.lastRob || 0;

            if (now < lastRob + ROB_COOLDOWN) {
                const remaining = lastRob + ROB_COOLDOWN - now;
                const hours = Math.floor(remaining / (1000 * 60 * 60));
                const minutes = Math.floor((remaining % (1000 * 60 * 60)) / (1000 * 60));

                throw createError(
                    "Sabar Nyet",
                    ErrorTypes.RATE_LIMIT,
                    `Istirahat Dulu **${hours}j ${minutes}m** Sebelum Merampok Lagi.`,
                    { remaining, hours, minutes, cooldownType: 'rob' }
                );
            }

            if (victimData.cash < 500) {
                throw createError(
                    "Gaada Duit Miskin Dia",
                    ErrorTypes.VALIDATION,
                    `${victimUser.username} Terlalu Miskin, Rp500 Di Dompet Aja Gaada`,
                    { victimCash: victimData.cash, required: 500 }
                );
            }

            const hasSafe = victimData.inventory["personal_safe"] || 0;

            if (hasSafe > 0) {
                robberData.lastRob = now;
                await setEconomyData(client, guildId, robberId, robberData);

                return await InteractionHelper.safeEditReply(interaction, {
                    embeds: [
                        warningEmbed(
                            '🛡️ Perampokan Diblokir',
                            `${victimUser.username} siap! Upaya Anda gagal karena mereka memiliki **Brankas Pribadi**. Anda berhasil kabur tetapi tidak mendapatkan apa pun.`
                        )
                    ],
                });
            }

            const isSuccessful = Math.random() < BASE_ROB_SUCCESS_CHANCE;
            let resultEmbed;

            if (isSuccessful) {
                const amountStolen = Math.floor(victimData.cash * ROB_PERCENTAGE);

                robberData.cash = (robberData.cash || 0) + amountStolen;
                victimData.cash = (victimData.cash || 0) - amountStolen;

                resultEmbed = successEmbed(
                    '💰 Perampokan Berhasil',
                    `Berhasil Mencuri **Rp${amountStolen.toLocaleString('id-ID')}** Dari ${victimUser.username}!`
                );
            } else {
                const fineAmount = Math.floor((robberData.cash || 0) * FINE_PERCENTAGE);

                if ((robberData.cash || 0) < fineAmount) {
                    robberData.cash = 0;
                } else {
                    robberData.cash = (robberData.cash || 0) - fineAmount;
                }

                resultEmbed = buildUserErrorEmbed(
                    'unknown',
                    `Bodoh Ketangkep Kan, Mana Disuruh Bayat Denda Lagi **Rp${fineAmount.toLocaleString('id-ID')}** Bangkrut Sudah.`,
                    { titleOverride: '❌ Perampokan Gagal' }
                );
            }

            robberData.lastRob = now;

            await setEconomyData(client, guildId, robberId, robberData);
            await setEconomyData(client, guildId, victimUser.id, victimData);

            resultEmbed
                .addFields(
                    {
                        name: `Cash Anda (${interaction.user.username})`,
                        value: `Rp${robberData.cash.toLocaleString('id-ID')}`,
                        inline: true,
                    },
                    {
                        name: `Cash Korban (${victimUser.username})`,
                        value: `Rp${victimData.cash.toLocaleString('id-ID')}`,
                        inline: true,
                    },
                )
                .setFooter({ text: `Perampokan berikutnya tersedia dalam ${Math.ceil(ROB_COOLDOWN / (60 * 60 * 1000))} jam.` });

            await InteractionHelper.safeEditReply(interaction, { embeds: [resultEmbed] });
    }, { command: 'rob' })
};
