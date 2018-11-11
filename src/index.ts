import { CommandClient } from 'eris';

const token = process.env['BOT_TOKEN'];
if (token == null) {
    console.error('BOT_TOKEN not set.');
    process.exit(1);
}

const bot = new CommandClient(token!, {}, {
    owner: 'Tirr',
});

bot.registerCommand('ping', 'Pong', {
    description: 'Ping pong',
    fullDescription: '간단한 핑퐁 커맨드입니다.',
});

bot.connect();

function handleTermination() {
    bot.disconnect({ reconnect: false });
    process.exit(0);
}

process.on('SIGINT', handleTermination);
process.on('SIGTERM', handleTermination);
