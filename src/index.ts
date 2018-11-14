import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as util from 'util';

import { Client, CommandClient, Message, TextChannel } from 'eris';
import * as dateFns from 'date-fns';

import * as image from './image';
import * as pixiv from './pixiv';

interface DiscordInfo {
    noticeChannelId?: string;
}

const token = process.env['BOT_TOKEN'];
if (token == null) {
    console.error('BOT_TOKEN not set.');
    process.exit(1);
}

const home = process.env['LUMINA_HOME'] || '/var/lib/lumina';
const privateKeyPath = path.join(home, 'rsa');
const publicKeyPath = path.join(home, 'rsa.pub');
const discordInfoPath = path.join(home, 'discord.json');
const pixivSessionPath = path.join(home, 'pixiv.json');
const noticePath = path.join(home, 'notices');

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

    try {
        await fs.promises.access(discordInfoPath, fs.constants.R_OK);
    } catch (_err) {
        await fs.promises.writeFile(discordInfoPath, JSON.stringify({}), { encoding: 'utf8', mode: 0o600 });
    }
    const discord = JSON.parse(await fs.promises.readFile(discordInfoPath, 'utf8'));

    await fs.promises.mkdir(noticePath, { recursive: true });

    return { discord, publicKey, privateKey };
}

async function saveDiscordInfo(discord: DiscordInfo) {
    await fs.promises.writeFile(discordInfoPath, JSON.stringify(discord), { encoding: 'utf8', mode: 0o600 });
}

async function processPixivIllust(bot: Client, msg: Message, id: string) {
    try {
        const session = await pixiv.PixivSession.fromSessionData(pixivSessionPath);
        const data = await session.getIllustInfo(id);
        let loadingMessage = await bot.createMessage(
            msg.channel.id,
            `**${data.userName}**의 **${data.title}**, 다운로드하고 있습니다. 잠시만 기다려 주세요!`,
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
            footer: {
                text: `${msg.author.username}님의 요청`,
                icon_url: msg.author.staticAvatarURL,
            },
        };
        const file = await session.downloadWithReferer(
            data.urls.original,
            `https://www.pixiv.net/member_illust.php?mode=medium&illust_id=${id}`,
        );
        if (file.length > 8e6) {
            const newLoadingMessage = await bot.createMessage(
                msg.channel.id,
                `**${data.userName}**의 **${data.title}**, 크기가 커서 줄이고 있어요.`,
            );
            await loadingMessage.delete();
            loadingMessage = newLoadingMessage;
            await bot.sendChannelTyping(msg.channel.id);
        }
        const processedFileData = await image.fitIntoSizeLimit(file);
        const fileFormat = processedFileData.format;
        const processedFile = processedFileData.data;

        await bot.createMessage(msg.channel.id, {
            content: '',
            embed,
        }, { file: processedFile, name: `${id}.${fileFormat}` });
        await loadingMessage.delete();
    } catch (err) {
        if (err instanceof pixiv.NotLoggedInError) {
            await bot.createMessage(msg.channel.id, ':x: 로그인부터 해야 해요!');
        } else if (err instanceof pixiv.NotFoundError) {
            await bot.createMessage(msg.channel.id, ':x: 일러스트를 찾을 수 없어요.');
        } else {
            console.error(err);
            await bot.createMessage(msg.channel.id, ':dizzy_face: 서버 오류예요...');
        }
    }
}

async function runAllNotices(bot: Client, noticeChannelId: string) {
    const files = await util.promisify(fs.readdir)(noticePath, { withFileTypes: true });
    const sortedFiles =
        files
            .filter(file => file.isFile())
            .sort((a, b) => {
                if (a.name < b.name) return -1;
                if (a.name > b.name) return 1;
                return 0;
            })
            .map(file => path.join(noticePath, file.name));
    for (const file of sortedFiles) {
        console.error('Processing notice file:', file);
        const content = await fs.promises.readFile(file, 'utf8');
        const processedContent = content.replace(/@me/g, `<@!${bot.user.id}>`);
        await bot.createMessage(noticeChannelId, processedContent);
        await fs.promises.unlink(file);
    }
}

async function main() {
    const { discord, publicKey, privateKey } = await initializeFilesystem();

    const bot = new CommandClient(token!, {}, {
        owner: 'Tirr',
    });

    bot.on('ready', async () => {
        if (discord.noticeChannelId != null) {
            await runAllNotices(bot, discord.noticeChannelId);
        }
    });

    bot.on('messageCreate', async msg => {
        const myId = bot.user.id;
        const mentions = [`<@${myId}>`, `<@!${myId}>`];
        const content = msg.content;
        const splitContent = content.split(' ');
        if (splitContent.length !== 2 || mentions.indexOf(splitContent[0]) === -1) {
            return;
        }

        // URL tests
        const url = splitContent[1];
        let regex;
        regex =
            /^https?:\/\/(?:www\.)?pixiv\.net\/i\/(\d+)$/.exec(url) ||
            (
                /^https?:\/\/(?:www\.)?pixiv\.net\/member_illust\.php/.test(url) ?
                /illust_id=(\d+)/.exec(url) :
                null
            );
        if (regex != null) {
            const id = regex[1];
            await processPixivIllust(bot, msg, id);
            if (msg.channel instanceof TextChannel) {
                await msg.delete();
            }
            return;
        }
    });

    const sudoCommand = bot.registerCommand('sudo', '', {
        hidden: true,
        requirements: { roleNames: ['operator'] }
    });

    sudoCommand.registerSubcommand('set-notice-channel', msg => {
        const channelId = msg.channel.id;
        discord.noticeChannelId = channelId;
        saveDiscordInfo(discord).catch(console.error);
        runAllNotices(bot, channelId).catch(console.error);
    }, {
        deleteCommand: true,
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

        processPixivIllust(bot, msg, id);
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
