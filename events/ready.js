module.exports = {
	name: 'ready',
	once: true,
	execute(client) {

        client.user.setActivity('la météo', { type: 'WATCHING' });
        console.log('Prêt !');
	},
};