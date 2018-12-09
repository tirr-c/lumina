import { Client, Message } from 'eris';

import { DiscordInfo, getAvatarUrl, getLinkedChannels, getOrCreateChannelWebhook } from '../discord';
import { fetchSyosetuInfo, NovelType } from '../syosetu';

export async function processSyosetuInfo(bot: Client, discord: DiscordInfo, msg: Message, ncode: string) {
    const info = await fetchSyosetuInfo(ncode);

    let status = '';
    if (info.type === NovelType.Short) {
        status = '단편';
    } else if (info.end) {
        status = '완결';
    } else {
        status = '연재 중';
    }
    const embed = {
        title: info.title,
        description: info.synopsis,
        url: `https://ncode.syosetu.com/${info.ncode}/`,
        author: {
            name: info.author.name,
            url: `https://mypage.syosetu.com/${info.author.id}/`,
        },
        fields: [
            { name: '연재 상태', value: status, inline: true },
            { name: '총 부분 수', value: `${info.parts}부분`, inline: true },
        ],
        footer: {
            text: '소설가가 되자',
        },
    };

    const channels = getLinkedChannels(discord, msg.channel.id);
    channels.unshift(msg.channel.id);
    const createMessagePromise = channels.map(async channelId => {
        const webhook = await getOrCreateChannelWebhook(bot, discord, channelId);
        await bot.executeWebhook(
            webhook.id,
            webhook.token,
            {
                content: '',
                embeds: [embed],
                username: msg.member && msg.member.nick ? msg.member.nick : msg.author.username,
                avatarURL: getAvatarUrl(msg.author),
            },
        );
    });
    await Promise.all(createMessagePromise);
}
