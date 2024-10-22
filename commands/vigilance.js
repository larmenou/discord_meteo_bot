const { SlashCommandBuilder } = require('discord.js');
const { generate_token } = require('../generate_token.js');
const { exec } = require('node:child_process');
const fs = require('fs');
const { access_token } = require('../config.json');
const path = require('path');

const configPath = path.join(__dirname, 'config.json');

// Fonction pour diviser un texte en segments de 2000 caractères ou moins
function splitText(text, maxLength = 2000) {
    return text.match(new RegExp(`.{1,${maxLength}}`, 'g'));
}

// Fonction pour télécharger l'image de vigilance
function downloadImage(access_token, interaction, retries = 0, maxRetries = 5) {
    return new Promise((resolve, reject) => {
        console.log("Début de la tentative de téléchargement de l'image");

        exec(`curl -X 'GET' \
            'https://public-api.meteofrance.fr/public/DPVigilance/v1/vignettenationale-J/encours' \
            -H 'accept: /' \
            -H 'Authorization: Bearer ${access_token}' \
            -o 'vigilance_data.png'`, (err, stdout, stderr) => {
            if (err) {
                console.log(err.code);
                if (err.code === 56 && retries < maxRetries) {
                    console.log(`Erreur 56 détectée. Tentative ${retries + 1}/${maxRetries}`);
                    setTimeout(() => {
                        downloadImage(access_token, interaction, retries + 1, maxRetries).then(resolve).catch(reject);
                    }, 5000); // Délai de 5 secondes entre les tentatives
                } else {
                    interaction.editReply("Erreur pendant le chargement de l'image.");
                    reject(err);
                }
            } else {
                resolve();
            }
        });
    });
}

// Fonction pour extraire les textes des zones
function extractDepTexts(data) {
    const depTexts = [];

    if(fs.existsSync('config.json'))
        config = fs.readFileSync(configPath, 'utf8');
    config = JSON.parse(config);
    const departements = config.departements;

    data.product.text_bloc_items.forEach(item => {
        if (item.bloc_id === 'BULLETIN_DEPARTEMENTAL' && departements.hasOwnProperty(item.domain_id)) {
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

// Fonction pour extraire les textes des périodes
function extractTextFromPeriods(data) {
    const texts = [];

    data.product.periods.forEach(period => {
        if (period.text_items && period.text_items.text && period.echeance == "J") {
            texts.push(...period.text_items.text);
        }
    });

    return texts;
}

// Fonction pour télécharger et traiter les textes de vigilance
function downloadText(access_token, interaction, retries = 0, maxRetries = 10) {
    return new Promise((resolve, reject) => {
        console.log("Début de la tentative de téléchargement du texte");

        let message = "**Vigilance en cours:**\n\n";

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
                        downloadText(access_token, interaction, retries + 1, maxRetries).then(resolve).catch(reject);
                    }, 5000); // Délai de 5 secondes entre les tentatives
                } else if (err.code === 404) {
                    interaction.editReply("Pas de vigilance en cours.");
                    reject(err);
                } else {
                    interaction.editReply("Erreur pendant le chargement du texte.");
                    reject(err);
                }
            } else {
                // Lire le fichier téléchargé
                const filePath = './vigilance_data.json';
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                const depTexts = extractDepTexts(data);

                depTexts.forEach(dep => {
                    message += `**${dep.domain_name}** : ${dep.text}\n\n`;
                });

                // Supprimer le fichier après l'envoi
                fs.unlinkSync(filePath);

                // Télécharger et extraire les textes des périodes
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
                                downloadText(access_token, interaction, retries + 1, maxRetries).then(resolve).catch(reject);
                            }, 5000); // Délai de 5 secondes entre les tentatives
                        } else if (err.code === 404) {
                            interaction.editReply("Pas de vigilance en cours.");
                            reject(err);
                        } else {
                            interaction.editReply("Erreur pendant le chargement du texte.");
                            reject(err);
                        }
                    } else {
                        // Lire le fichier téléchargé
                        const filePath = './vigilanceCarte_data.json';
                        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

                        const texts = extractTextFromPeriods(data);

                        texts.forEach(text => {
                            message += `${text}\n\n`;
                        });

                        // Supprimer le fichier après l'envoi
                        fs.unlinkSync(filePath);

                        // Envoyer le message final
                        resolve(message);
                    }
                });
            }
        });
    });
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('vigilance')
        .setDescription('Donne la carte et le descriptif des vigilances en cours en France métropolitaine'),
    async execute(interaction) {
        await interaction.deferReply(); // Indique que la réponse peut prendre du temps

        generate_token((err, access_token) => {
            if (err) {
                interaction.editReply("Erreur pendant la génération de token.");
                return;
            }

            downloadImage(access_token, interaction)
                .then(() => downloadText(access_token, interaction))
                .then((message) => {
                    const imagePath = './vigilance_data.png';
                    const file = fs.readFileSync(imagePath);

                    // Diviser le message en segments de 2000 caractères ou moins
                    const segments = splitText(message);

                    // Envoyer chaque segment du message
                    segments.forEach((segment, index) => {
                        if (index === 0) {
                            // Envoyer le premier segment avec l'image
                            interaction.editReply({
                                content: segment,
                                files: [{
                                    attachment: file,
                                    name: 'vigilance_data.png'
                                }]
                            }).then(() => {
                                // Supprimer le fichier après l'envoi
                                fs.unlinkSync(imagePath);
                            }).catch((error) => {
                                console.error("Erreur lors de l'envoi du fichier:", error);
                                interaction.editReply("Erreur lors de l'envoi du fichier.");
                            });
                        } else {
                            // Envoyer les segments suivants sans l'image
                            interaction.followUp({
                                content: segment
                            });
                        }
                    });
                })
                .catch(err => {
                    console.error("Erreur lors du téléchargement des données:", err);
                    interaction.editReply("Erreur lors du téléchargement des données. Réessayez. Si le problème persiste, contactez l'administrateur.");
                });
        });
    }
};