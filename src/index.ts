import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as util from 'util';

import { CommandClient, TextChannel } from 'eris';
import * as dateFns from 'date-fns';

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

    bot.registerCommand('공개키', '```\n' + publicKey + '```', {
        description: '공개 키 출력',
        fullDescription: '제 공개 키를 알려줄게요.',
    });

    const pixivCommand = bot.registerCommand('픽시브', msg => {
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

    pixivCommand.registerSubcommand('로그인', (msg, args) => {
        if (args.length !== 1) {
            return ':x: Base64 데이터가 필요해요.';
        }
        let data: Buffer;
        try {
            const b64data = args[0].replace(/`/g, '');
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
            } else if (err instanceof pixiv.DecryptError) {
                sendMsg = ':x: 복호화에 실패했어요. 키는 맞게 입력하셨나요?';
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

    pixivCommand.registerSubcommand('일러스트', (msg, args) => {
        if (args.length !== 1) {
            return ':x: 일러스트 ID를 한 개 입력해 주세요.';
        }
        const id = args[0];
        if (!/^\d+$/.test(id)) {
            return ':x: 일러스트 ID는 숫자로만 이루어져 있어요.';
        }

        (async function () {
            const session = await pixiv.PixivSession.fromSessionData(pixivSessionPath);
            const data = await session.getIllustInfo(id);
            const loadingMessage = await bot.createMessage(
                msg.channel.id,
                `**${data.userName}**의 **${data.title}** 다운로드하고 있습니다. 잠시만 기다려 주세요!`,
            );
            await bot.sendChannelTyping(msg.channel.id);
            const embed = {
                title: data.title,
                description: data.description,
                url: `https://www.pixiv.net/i/${data.id}`,
                timestamp: dateFns.format(data.createDate),
                color: 0x0096fa,
                provider: {
                    name: 'pixiv',
                    url: 'https://www.pixiv.net/',
                },
                author: {
                    name: data.userName,
                    url: `https://www.pixiv.net/u/${data.userId}`,
                },
            };
            const file = await session.downloadWithReferer(
                data.urls.regular,
                `https://www.pixiv.net/member_illust.php?mode=medium&illust_id=${id}`,
            );
            await bot.createMessage(msg.channel.id, {
                content: '',
                embed,
            }, { file, name: `${id}.jpg` });
            await loadingMessage.delete();
        })().catch(err => {
            if (err instanceof pixiv.NotLoggedInError) {
                return ':x: 로그인부터 해야 해요!';
            } else {
                console.error(err);
                return ':dizzy_face: 서버 오류예요...';
            }
        });
    }, {
        description: '일러스트 조회',
        fullDescription: '일러스트 정보를 가져옵니다.',
    });
    bot.connect();

    process.on('SIGINT', () => handleTermination(bot));
    process.on('SIGTERM', () => handleTermination(bot));
}

main().catch(err => {
    console.error(err);
    process.exit(2);
});
