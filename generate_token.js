const { exec } = require('node:child_process');
const fs = require('fs');
const { token_mf_app_id } = require('./config.json');

function generate_token(callback) {
    /*
      Génère un nouveau token OAUTH2 pour les appels API de meteo-france
    */

    exec(`curl -k -X POST https://portail-api.meteofrance.fr/token -d "grant_type=client_credentials" -H "Authorization: Basic ${token_mf_app_id}"`, (err, stdout, stderr) => {
        if (err) {
            callback(err, null);
            return;
        }

        try {
            const data = JSON.parse(stdout);
            const configPath = './config.json';
            const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            config.access_token = data.access_token;
            fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

            callback(null, data.access_token);
        } catch (parseError) {
            callback(parseError, null);
        }
    });
}

module.exports = { generate_token };
