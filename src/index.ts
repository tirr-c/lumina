import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as util from 'util';

import axios from 'axios';
import { Client, CommandClient, Message, TextChannel, Webhook } from 'eris';
import * as dateFns from 'date-fns';

import { DiscordInfo, getLinkedChannels, getOrCreateChannelWebhook, saveDiscordInfo } from './discord';
import * as airHandlers from './handler/air';
import * as pixivHandlers from './handler/pixiv';
import * as image from './image';
import {
    home,
    privateKeyPath,
    publicKeyPath,
    discordInfoPath,
    pixivSessionPath,
    noticePath,
    kakaoTokenPath,
} from './path';
import * as pixiv from './pixiv';
import { createUnfurler } from './unfurler';

const token = process.env['BOT_TOKEN'];
if (token == null) {
    console.error('BOT_TOKEN not set.');
    process.exit(1);
}

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
        await fs.promises.writeFile(
            discordInfoPath,
            JSON.stringify({
                linkedChannels: {},
                webhooks: {},
            }),
            { encoding: 'utf8', mode: 0o600 },
        );
    }
    const discord = JSON.parse(await fs.promises.readFile(discordInfoPath, 'utf8'));

    await fs.promises.mkdir(noticePath, { recursive: true });

    let kakaoToken: string | undefined;
    try {
        kakaoToken = (await fs.promises.readFile(kakaoTokenPath, 'utf8')).trim();
    } catch (_err) {
    }

    return { discord, kakaoToken, publicKey, privateKey };
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
    const { discord, kakaoToken, publicKey, privateKey } = await initializeFilesystem();

    const unfurler = createUnfurler();

    const bot = new CommandClient(token!, {}, {
        defaultHelpCommand: false,
        prefix: '루미나,',
    });

    bot.on('ready', async () => {
        if (discord.noticeChannelId != null) {
            await runAllNotices(bot, discord.noticeChannelId);
        }
    });

    bot.on('messageCreate', async msg => {
        const myId = bot.user.id;
        if (msg.author.id === myId || msg.author.bot) {
            return;
        }
        const mentions = ['루미나,'];
        const content = msg.content;
        const splitContent = content.split(' ').filter(x => x !== '');
        if (splitContent.length === 2 && mentions.indexOf(splitContent[0]) !== -1) {
            // URL tests
            const url = new URL(splitContent[1]);
            const successful = unfurler.tryUnfurl(bot, discord, msg, url);
            if (await successful) {
                if (msg.channel instanceof TextChannel) {
                    await msg.delete();
                }
                return;
            }
        }

        const channelId = msg.channel.id;
        const linkedChannels = getLinkedChannels(discord, channelId);
        if (linkedChannels.length > 0) {
            const file = await Promise.all(msg.attachments.map(async attach => {
                const file = (await axios.get(attach.url, { responseType: 'arraybuffer' })).data;
                return {
                    file,
                    name: attach.filename,
                };
            }));
            const bridgePromise = linkedChannels.map(async (targetChannelId: string) => {
                const webhook = await getOrCreateChannelWebhook(bot, discord, targetChannelId);
                await bot.executeWebhook(
                    webhook.id,
                    webhook.token,
                    {
                        content: msg.cleanContent,
                        file,
                        embeds: msg.embeds,
                        username: msg.member && msg.member.nick ? msg.member.nick : msg.author.username,
                        avatarURL: msg.author.avatarURL,
                    },
                );
            });
            await Promise.all(bridgePromise).catch(console.error);
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

    bot.registerCommand('공개키', '```\n' + publicKey + '```');

    if (kakaoToken != null) {
        bot.registerCommand('미세먼지', (msg, args) => {
            const query = args.join(' ');
            if (query === '') {
                return ':x: 위치를 알려 주세요.'
            }

            airHandlers.handleAirQuery(bot, msg, { kakaoToken, query }).catch(err => {
                console.error(err);
                bot.createMessage(
                    msg.channel.id,
                    ':dizzy_face: 서버 오류예요...',
                );
            });
        });
    }

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
    });

    pixivCommand.registerSubcommand('유저', (msg, args) => {
        if (args.length !== 1) {
            return ':x: 유저 ID를 한 개 입력해 주세요.';
        }
        const id = args[0];
        if (!/^\d+$/.test(id)) {
            return ':x: 유저 ID는 숫자로만 이루어져 있어요.';
        }

        pixivHandlers.processUserRequest(bot, discord, msg, id);
    });

    pixivCommand.registerSubcommand('일러스트', (msg, args) => {
        if (args.length !== 1) {
            return ':x: 일러스트 ID를 한 개 입력해 주세요.';
        }
        const id = args[0];
        if (!/^\d+$/.test(id)) {
            return ':x: 일러스트 ID는 숫자로만 이루어져 있어요.';
        }

        pixivHandlers.processIllustRequest(bot, discord, msg, id);
    });

    bot.connect();

    process.on('SIGINT', () => handleTermination(bot));
    process.on('SIGTERM', () => handleTermination(bot));
}

main().catch(err => {
    console.error(err);
    process.exit(2);
});
