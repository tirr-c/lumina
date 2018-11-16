import * as dateFns from 'date-fns';
import { Client, CommandClient, Message, TextChannel } from 'eris';

import * as image from '../image';
import { pixivSessionPath } from '../path';
import * as pixiv from '../pixiv';

export async function processIllustRequest(bot: Client, msg: Message, id: string) {
    try {
        const session = await pixiv.PixivSession.fromSessionData(pixivSessionPath);
        const data = await session.getIllustInfo(id);
        const restricted = data.restrict !== 0 || data.xRestrict !== 0;
        const restrictedEmoji = restricted ? ':underage: ' : '';
        if (restricted && msg.channel instanceof TextChannel && !msg.channel.nsfw) {
            await bot.createMessage(
                msg.channel.id,
                ':underage: 후방주의 채널이 필요해요.'
            );
            return;
        }
        let loadingMessage = await bot.createMessage(
            msg.channel.id,
            `${restrictedEmoji}**${data.userName}**의 **${data.title}**, 다운로드하고 있습니다. 잠시만 기다려 주세요!`,
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
