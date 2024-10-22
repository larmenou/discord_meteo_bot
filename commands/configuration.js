const { SlashCommandBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

// Chemin vers le fichier de configuration
const configPath = path.join(__dirname, 'config.json');

// Fonction pour lire le fichier de configuration
function readConfig() {
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Erreur lors de la lecture du fichier de configuration:", err);
        return {};
    }
}

// Fonction pour écrire dans le fichier de configuration
function writeConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error("Erreur lors de l'écriture du fichier de configuration:", err);
    }
}

function validateDepartements(departements) {
    const regex = /^[0-9\s]+$/;
    return departements.every(departement => regex.test(departement));
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('config')
        .setDescription('Configurer les options de vigilance')
        .addSubcommand(subcommand =>
            subcommand.setName('add')
                .setDescription('Ajouter des départements à la configuration')
                .addStringOption(option =>
                    option.setName('departements')
                        .setDescription('Liste des départements à ajouter (séparés par des espaces). Ex: 01, 15, 77, 89')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('remove')
                .setDescription('Retirer des départements de la configuration')
                .addStringOption(option =>
                    option.setName('departements')
                        .setDescription('Liste des départements à retirer (séparés par des espaces). Ex: 01, 15, 77, 89')
                        .setRequired(true)))
        .addSubcommand(subcommand =>
            subcommand.setName('list')
                .setDescription('Lister les départements disponibles')),
    async execute(interaction) {
        try {
            const subcommand = interaction.options.getSubcommand();

            if (subcommand === 'add' || subcommand === 'remove') {
                const departements = interaction.options.getString('departements')?.split(' ').map(departement => departement.trim()) || [];
                departements.sort((a, b) => a.localeCompare(b));

                if (!validateDepartements(departements)) {
                    await interaction.reply("Erreur: Les départements doivent être des chiffres séparés par des espaces.");
                    return;
                }

                const config = readConfig();
                const departementsDict = config.departements || {};

                if (subcommand === 'add') {
                    departements.forEach(departement => {
                        departementsDict[departement] = 0;
                    });
                } else if (subcommand === 'remove') {
                    departements.forEach(departement => {
                        delete departementsDict[departement];
                    });
                }

                config.departements = departementsDict;
                writeConfig(config);

                await interaction.reply(`Configuration mise à jour: Départements: ${Object.keys(departementsDict).join(', ')}`);
            } else if (subcommand === 'list') {
                const config = readConfig();
                const departementsDict = config.departements || {};
                const departementsList = Object.keys(departementsDict).join(', ');

                if (departementsList.length === 0) {
                    await interaction.reply('Aucun département disponible.');
                } else {
                    await interaction.reply(`Départements configurés: ${departementsList}`);
                }
            }
        } catch (error) {
            console.error(error);
            if (!interaction.replied) {
                await interaction.reply('Quelque chose ne va pas avec cette commande, rapprochez-vous de mon administrateur.');
            } else {
                await interaction.followUp('Quelque chose ne va pas avec cette commande, rapprochez-vous de mon administrateur.');
            }
        }
    }
};
