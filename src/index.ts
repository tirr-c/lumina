import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as util from 'util';
import { CommandClient, TextChannel } from 'eris';

const token = process.env['BOT_TOKEN'];
if (token == null) {
    console.error('BOT_TOKEN not set.');
    process.exit(1);
}

const home = process.env['LUMINA_HOME'] || '/var/lib/lumina';
const privateKeyPath = path.join(home, 'rsa');
const publicKeyPath = path.join(home, 'rsa.pub');
const pixivDir = path.join(home, 'pixiv');

function handleTermination(bot?: CommandClient) {
    bot && bot.disconnect({ reconnect: false });
    process.exit(0);
}

async function initializeFilesystem() {
    await fs.promises.mkdir(home, { recursive: true });

    try {
        await fs.promises.access(privateKeyPath, fs.constants.R_OK);
    } catch (err) {
        console.error('Generating a key pair...');
        const { publicKey, privateKey } = await util.promisify(crypto.generateKeyPair)(
            'rsa',
            {
                modulusLength: 2048,
                publicKeyEncoding: {
                    type: 'spki',
                    format: 'pem',
                },
                privateKeyEncoding: {
                    type: 'pkcs8',
                    format: 'pem',
                    cipher: 'aes-256-cbc',
                    passphrase: 'lumina',
                },
            },
        );
        await fs.promises.writeFile(privateKeyPath, privateKey, { encoding: 'utf8', mode: 0o600 });
        await fs.promises.writeFile(publicKeyPath, publicKey, { encoding: 'utf8', mode: 0o600 });
        await fs.promises.chmod(privateKeyPath, 0o400);
        await fs.promises.chmod(publicKeyPath, 0o400);
    }
    const privateKey = await fs.promises.readFile(privateKeyPath, 'utf8');
    await fs.promises.access(publicKeyPath, fs.constants.R_OK);
    const publicKey = await fs.promises.readFile(publicKeyPath, 'utf8');
    console.error('Successfully loaded key pair');

    await fs.promises.mkdir(pixivDir, { recursive: true });

    return { publicKey, privateKey };
}

async function main() {
    const { publicKey, privateKey } = await initializeFilesystem();

    const bot = new CommandClient(token!, {}, {
        owner: 'Tirr',
    });

    bot.registerCommand('key', '```\n' + publicKey + '```', {
        description: '공개 키 출력',
        fullDescription: '제 공개 키를 알려줄게요.',
    });

    bot.registerCommand('pixiv', msg => {
        (async function () {
            const requestedUserId = `user-${msg.author.id}`;
            let isGuild = msg.channel instanceof TextChannel;
            let guildAuthenticated = isGuild;
            let fromUserId = requestedUserId;
            if (msg.channel instanceof TextChannel) {
                const guildId = `guild-${msg.channel.guild.id}`;
                const guildInfoPath = path.join(pixivDir, guildId);
                try {
                    await fs.promises.access(guildInfoPath, fs.constants.R_OK);
                    fromUserId = await fs.promises.readFile(guildInfoPath, 'utf8');
                } catch (err) {
                    guildAuthenticated = false;
                }
            }
            let userAuthenticated = true;
            const userInfoPath = path.join(pixivDir, fromUserId);
            try {
                await fs.promises.access(userInfoPath, fs.constants.R_OK);
            } catch (err) {
                userAuthenticated = false;
            }

            if (guildAuthenticated) {
                return ':white_check_mark: 서버에 계정이 등록되어 있어요.';
            } else if (userAuthenticated) {
                if (isGuild) {
                    return ':hourglass: 서버에 등록된 계정은 없지만, 당신의 계정을 등록할 수 있어요!';
                } else {
                    return ':white_check_mark: 당신의 계정 정보가 있어요.';
                }
            } else {
                if (isGuild) {
                    return ':x: 서버에 등록된 계정도 없고, 당신도 계정을 등록해야 할 것 같은데요!';
                } else {
                    return ':x: 계정 정보가 없네요.';
                }
            }
        })().then(sendMsg => {
            bot.createMessage(msg.channel.id, sendMsg);
        }).catch(err => {
            console.error(err);
            bot.createMessage(msg.channel.id, ':dizzy_face: 서버 오류예요...');
        });
    }, {
        description: '픽시브 관련 명령',
        fullDescription: '픽시브와 관련된 명령들이에요.',
    });

    bot.registerCommand('ping', 'Pong', {
        description: 'Ping pong',
        fullDescription: '간단한 핑퐁 커맨드입니다.',
    });

    bot.connect();

    process.on('SIGINT', () => handleTermination(bot));
    process.on('SIGTERM', () => handleTermination(bot));
}

main().catch(err => {
    console.error(err);
    process.exit(2);
});
