import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as util from 'util';
import { CommandClient, TextChannel } from 'eris';

import * as pixiv from './pixiv';

const token = process.env['BOT_TOKEN'];
if (token == null) {
    console.error('BOT_TOKEN not set.');
    process.exit(1);
}

const home = process.env['LUMINA_HOME'] || '/var/lib/lumina';
const privateKeyPath = path.join(home, 'rsa');
const publicKeyPath = path.join(home, 'rsa.pub');
const pixivSessionPath = path.join(home, 'pixiv.json');

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

    const pixivCommand = bot.registerCommand('pixiv', msg => {
        (async function () {
            let userAuthenticated = true;
            try {
                await fs.promises.access(pixivSessionPath, fs.constants.R_OK);
            } catch (err) {
                userAuthenticated = false;
            }

            if (userAuthenticated) {
                return ':white_check_mark: 서버에 계정이 등록되어 있어요.';
            } else {
                return ':x: 계정 정보가 없네요.';
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

    pixivCommand.registerSubcommand('login', (msg, args) => {
        if (args.length !== 1) {
            return ':x: Base64 데이터가 필요해요.';
        }
        let data: Buffer;
        try {
            const b64data = args[0];
            data = Buffer.from(b64data, 'base64');
        } catch (err) {
            if (err instanceof TypeError) {
                return ':x: Base64가 아닌 것 같은데요!';
            } else {
                console.error(err);
                return ':dizzy_face: 서버 오류예요...';
            }
        }

        (async function () {
            const session = await pixiv.PixivSession.loginWithEncrypted(privateKey, data);
            await session.saveSessionData(pixivSessionPath);
            return ':white_check_mark: 로그인 성공!';
        })().then(sendMsg => {
            bot.createMessage(msg.channel.id, sendMsg);
        }).catch(err => {
            let sendMsg;
            if (err instanceof pixiv.PixivLoginFormatError) {
                sendMsg = ':x: 유저명과 비밀번호가 안 보여요.';
            } else if (err instanceof pixiv.PixivLoginError) {
                sendMsg = ':x: 로그인에 실패했어요.';
            } else {
                console.error(err);
                sendMsg = ':dizzy_face: 서버 오류예요...';
            }
            bot.createMessage(msg.channel.id, sendMsg);
        });
    }, {
        description: '로그인',
        fullDescription: '암호화된 Base64 데이터를 써서 로그인해요.',
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
