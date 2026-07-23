import { SlashCommandBuilder } from 'discord.js';
import { createEmbed, errorEmbed, successEmbed, infoEmbed, warningEmbed } from '../../utils/embeds.js';
import { getEconomyData, setEconomyData, getMaxBankCapacity } from '../../utils/economy.js';
import { withErrorHandling, createError, ErrorTypes } from '../../utils/errorHandler.js';

import { InteractionHelper } from '../../utils/interactionHelper.js';
export default {
    data: new SlashCommandBuilder()
        .setName('withdraw')
        .setDescription('Tarik uang dari bank ke dompet')
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('Jumlah yang akan ditarik')
                .setRequired(true)
                .setMinValue(1)
        ),

    execute: withErrorHandling(async (interaction, config, client) => {
        await InteractionHelper.safeDefer(interaction);
            
            const userId = interaction.user.id;
            const guildId = interaction.guildId;
            const amountInput = interaction.options.getInteger("amount");

            const userData = await getEconomyData(client, guildId, userId);
            
            if (!userData) {
                throw createError(
                    "Gagal memuat data ekonomi",
                    ErrorTypes.DATABASE,
                    "Gagal memuat data ekonomi Anda. Silakan coba lagi nanti.",
                    { userId, guildId }
                );
            }

            let withdrawAmount = amountInput;

            if (withdrawAmount <= 0) {
                throw createError(
                    "Kalo Mau Narik Mikir Kids",
                    ErrorTypes.VALIDATION,
                    "Minimal Masukin Jumlah Penarikan Yang Wajar",
                    { amount: withdrawAmount, userId }
                );
            }

            if (withdrawAmount > userData.bank) {
                withdrawAmount = userData.bank;
            }

            if (withdrawAmount === 0) {
                throw createError(
                    "Gaada Duit Di Bank Lu 😹",
                    ErrorTypes.VALIDATION,
                    "Rekening Bank Kosong Buat Apa 😹.",
                    { userId, bankBalance: userData.bank }
                );
            }

            userData.cash += withdrawAmount;
            userData.bank -= withdrawAmount;

            await setEconomyData(client, guildId, userId, userData);

            const embed = successEmbed(
                '💰 Penarikan Berhasil',
                `berhasil menarik **Rp${withdrawAmount.toLocaleString('id-ID')}** dari bank Anda.`
            )
                .addFields(
                    {
                        name: "Saldo Dompet",
                        value: `Rp${userData.cash.toLocaleString('id-ID')}`,
                        inline: true,
                    },
                    {
                        name: "Saldo Bank",
                        value: `Rp${userData.bank.toLocaleString('id-ID')}`,
                        inline: true,
                    },
                );

            await InteractionHelper.safeEditReply(interaction, { embeds: [embed] });
    }, { command: 'withdraw' })
};
