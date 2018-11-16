import * as dateFns from 'date-fns';
import { Client, CommandClient, Message, TextChannel } from 'eris';

import * as image from '../image';
import { pixivSessionPath } from '../path';
import * as pixiv from '../pixiv';

export async function processIllustRequest(bot: Client, msg: Message, id: string) {
    try {
        const session = await pixiv.PixivSession.fromSessionData(pixivSessionPath);
        const data = await session.getIllustInfo(id);

        const footer = msg.member && {
            text: `${msg.member.nick || msg.member.username}님의 요청`,
            icon_url: msg.member.staticAvatarURL,
        };
        const fields = [];
        fields.push({
            name: '종류',
            value: pixiv.illustTypeToString(data.illustType),
            inline: true,
        });
        if (data.pageCount > 1) {
            fields.push({
                name: '장 수',
                value: `${data.pageCount}장`,
                inline: true,
            });
        }
        if (data.seriesNavData != null) {
            fields.push({
                name: '시리즈',
                value: data.seriesNavData.title,
            });
        }
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
            footer,
            fields,
        };

        const restricted = data.restrict !== 0 || data.xRestrict !== 0;
        const restrictedEmoji = restricted ? ':underage: ' : '';

        if (restricted && msg.channel instanceof TextChannel && !msg.channel.nsfw) {
            await bot.createMessage(
                msg.channel.id,
                {
                    content: ':underage: 후방주의 채널에서만 볼 수 있어요.',
                    embed,
                },
            );
            return;
        }

        let loadingMessage = await bot.createMessage(
            msg.channel.id,
            `${restrictedEmoji}**${data.userName}**의 **${data.title}**, 다운로드하고 있습니다. 잠시만 기다려 주세요!`,
        );
        await bot.sendChannelTyping(msg.channel.id);

        const file = await session.downloadWithReferer(
            data.urls.original,
            `https://www.pixiv.net/member_illust.php?mode=medium&illust_id=${id}`,
        );
        if (file.length > 8e6) {
            const newLoadingMessage = await bot.createMessage(
                msg.channel.id,
                `${restrictedEmoji}**${data.userName}**의 **${data.title}**, 크기가 커서 줄이고 있어요.`,
            );
            await loadingMessage.delete();
            loadingMessage = newLoadingMessage;
            await bot.sendChannelTyping(msg.channel.id);
        }
        const processedFileData = await image.fitIntoSizeLimit(file);
        const fileFormat = processedFileData.format;
        const processedFile = processedFileData.data;

        await bot.createMessage(msg.channel.id, {
            content: restricted ? ':underage: R-18으로 지정된 일러스트입니다.' : '',
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

export async function processUserRequest(bot: Client, msg: Message, id: string) {
    try {
        const session = await pixiv.PixivSession.fromSessionData(pixivSessionPath);
        const user = await session.getUser(id);

        const thumbnail = user.imageBig != null ? { url: user.imageBig } : undefined;
        const embed = {
            title: user.name,
            description: user.comment,
            url: `https://www.pixiv.net/u/${user.userId}`,
            color: 0x0096fa,
            thumbnail,
        };

        await bot.createMessage(
            msg.channel.id,
            {
                content: '',
                embed,
            },
        );
    } catch (err) {
        if (err instanceof pixiv.NotLoggedInError) {
            await bot.createMessage(msg.channel.id, ':x: 로그인부터 해야 해요!');
        } else if (err instanceof pixiv.NotFoundError) {
            await bot.createMessage(msg.channel.id, ':x: 유저를 찾을 수 없어요.');
        } else {
            console.error(err);
            await bot.createMessage(msg.channel.id, ':dizzy_face: 서버 오류예요...');
        }
    }
}