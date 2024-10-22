const fs = require('fs');
const { Client, Collection, GatewayIntentBits } = require('discord.js');
const { token } = require('./config.json');
const cron = require('node-cron');
const { exec } = require('node:child_process');
const path = require('path');

const { generate_token } = require('./generate_token.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();

const commandFiles = fs.readdirSync('./commands').filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    client.commands.set(command.data.name, command);
}

const eventFiles = fs.readdirSync('./events').filter(file => file.endsWith('.js'));

for (const file of eventFiles) {
    const event = require(`./events/${file}`);
    if (event.once) {
        client.once(event.name, (...args) => event.execute(...args));
    } else {
        client.on(event.name, (...args) => event.execute(...args));
    }
}

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(error);
        await interaction.reply('Quelque chose ne va pas avec cette commande, rapprochez vous de mon administrateur.');
    }
});

client.login(token);


const configPath = path.join(__dirname, './commands/config.json');

function readConfig() {
    try {
        const data = fs.readFileSync(configPath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error("Erreur lors de la lecture du fichier de configuration:", err);
        return {};
    }
}

function writeConfig(config) {
    try {
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    } catch (err) {
        console.error("Erreur lors de l'écriture du fichier de configuration:", err);
    }
}

// Fonction pour diviser un texte en segments de 2000 caractères ou moins
function splitText(text, maxLength = 2000) {
    return text.match(new RegExp(`.{1,${maxLength}}`, 'g'));
}


// Fonction pour envoyer des notifications de vigilance
function sendVigilanceNotifications(message) {
    const channelId = '1280039808596447283'; // Remplacez par l'ID du canal où envoyer les notifications
    const channel = client.channels.cache.get(channelId);

    if (channel) {
        const segments = splitText(message);
        if (!segments)
        {
            console.log("RAS");
            return ;
        }
        segments.forEach(segment => {
            channel.send(segment);
        });
    } else {
        console.error('Le canal spécifié n\'existe pas.');
    }
}

function alerteDep(dict)
{
    let message = "";
    for (const dep in dict)
    {
        message += "**Attention, nouvelles vigilances en cours**\n";
        message += dep + ": vigilance ";
        if (dict[dep] == 3)
            message += "orange.";
        if (dict[dep] == 4)
            message += "rouge.";
    }
    return (message);
}


function extractDepTexts(data, dict) {
    const depTexts = [];

    data.product.text_bloc_items.forEach(item => {
        if (item.bloc_id === 'BULLETIN_DEPARTEMENTAL' && dict.hasOwnProperty(item.domain_id)) {
            item.bloc_items.forEach(blocItem => {
                blocItem.text_items.forEach(textItem => {
                    textItem.term_items.forEach(termItem => {
                        termItem.subdivision_text.forEach(subdivisionText => {
                            const domainParts = item.domain_name.split(' ');
                            const domainName = domainParts.length > 1 ? domainParts[1] : item.domain_name;
                            depTexts.push({
                                domain_name: domainName,
                                text: subdivisionText.text.join(' ')
                            });
                        });
                    });
                });
            });
        }
    });

    return depTexts;
}

function extractDepVig(data) {
    const maxColorIds = {};
    const seenDomains = new Set();

    if (fs.existsSync('config.json')) {
        const config = JSON.parse(fs.readFileSync('./commands/config.json', 'utf8'));
        const departements = config.departements;

        data.product.periods.forEach(period => {
            period.timelaps.domain_ids.forEach(domain => {
                if (departements.hasOwnProperty(domain.domain_id) && !seenDomains.has(domain.domain_id)) {
                    maxColorIds[domain.domain_id] = domain.max_color_id;
                    seenDomains.add(domain.domain_id);
                }
            });
        });
    } else {
        console.error('Le fichier config.json n\'existe pas.');
    }

    return maxColorIds;
}

function downloadText(access_token, dict, message, retries = 0, maxRetries = 10) {
    return new Promise((resolve, reject) => {
        console.log("Début de la tentative de téléchargement du texte");

        exec(`curl -X 'GET' \
            'https://public-api.meteofrance.fr/public/DPVigilance/v1/textesvigilance/encours' \
            -H 'accept: /' \
            -H 'Authorization: Bearer ${access_token}' \
            -o 'vigilance_data.json'`, (err, stdout, stderr) => {
            if (err) {
                console.log(err.code);
                if (err.code === 56 && retries < maxRetries) {
                    console.log(`Erreur 56 détectée. Tentative ${retries + 1}/${maxRetries}`);
                    setTimeout(() => {
                        downloadText(access_token, dict, message, retries + 1, maxRetries).then(resolve).catch(reject);
                    }, 5000); // Délai de 5 secondes entre les tentatives
                } else if (err.code === 404) {
                    reject(err);
                } else {
                    reject(err);
                }
            } else {
                // Lire le fichier téléchargé
                const filePath = './vigilance_data.json';
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const depTexts = extractDepTexts(data, dict);

                message += alerteDep(dict);

                depTexts.forEach(dep => {
                    message += `**${dep.domain_name}** : ${dep.text}\n\n`;
                });

                // Supprimer le fichier après l'envoi
                fs.unlinkSync(filePath);

                sendVigilanceNotifications(message);
            }
        });
    });
}


function downloadRisk(access_token, retries = 0, maxRetries = 10) {
    return new Promise((resolve, reject) => {
        console.log("Début de la tentative de téléchargement du json");

        exec(`curl -X 'GET' \
            'https://public-api.meteofrance.fr/public/DPVigilance/v1/cartevigilance/encours' \
            -H 'accept: /' \
            -H 'Authorization: Bearer ${access_token}' \
            -o 'vigilanceCarte_data.json'`, (err, stdout, stderr) => {
            if (err) {
                console.log(err.code);
                if (err.code === 56 && retries < maxRetries) {
                    console.log(`Erreur 56 détectée. Tentative ${retries + 1}/${maxRetries}`);
                    setTimeout(() => {
                        downloadRisk(access_token, retries + 1, maxRetries).then(resolve).catch(reject);
                    }, 5000); // Délai de 5 secondes entre les tentatives
                } else if (err.code === 404) {
                    reject(err);
                } else {
                    reject(err);
                }
            } else {
                // Lire le fichier téléchargé
                const filePath = './vigilanceCarte_data.json';
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                const risk = extractDepVig(data);

                let config = readConfig();
                let departementsDict = config.departements;
                let message = "";

                let vigi = {};
                for (const departement in risk)
                {
                    if (risk[departement] > 2 && risk[departement] > departementsDict[departement])
                        vigi[departement] = risk[departement];
                    if (risk[departement] < 4 && risk[departement] < departementsDict[departement])
                        message += "Baisse de vigilance pour "+departement+"\n";
                    departementsDict[departement] = risk[departement];
                }

                config.departements = departementsDict;
                writeConfig(config);

                // Supprimer le fichier après l'envoi
                fs.unlinkSync(filePath);

                downloadText(access_token, vigi, message);
            }
        });
    });
}

console.log("Début du cron.");
cron.schedule('*/30 * * * *', () => {
    generate_token((err, access_token) => {
        if (err) {
            console.error("Erreur pendant la génération de token.");
            console.error(err);
            return;
        }
        downloadRisk(access_token);
    });
});
