import { Client, Message } from 'eris';

import { DiscordInfo, getLinkedChannels, getOrCreateChannelWebhook } from '../discord';
import { fetchSyosetuInfo } from '../syosetu';

export async function processSyosetuInfo(bot: Client, discord: DiscordInfo, msg: Message, ncode: string) {
    const info = await fetchSyosetuInfo(ncode);

    const url = `https://ncode.syosetu.com/${info.ncode}/`;
    const embed = {
        title: info.title,
        description: info.synopsis,
        url,
        author: info.author,
        fields: [
            { name: '연재 상태', value: info.end ? '완결' : '연재 중', inline: true },
            { name: '총 부분 수', value: `${info.parts}부분`, inline: true },
        ],
    };

    const channels = getLinkedChannels(discord, msg.channel.id);
    channels.unshift(msg.channel.id);
    const createMessagePromise = channels.map(async channelId => {
        await bot.createMessage(
            msg.channel.id,
            { content: '', embed },
        );
    });
    await Promise.all(createMessagePromise);
}
