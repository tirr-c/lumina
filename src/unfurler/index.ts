import { URL } from 'url';

import { Client, Message } from 'eris';

import { DiscordInfo } from '../discord';
import * as pixiv from './pixiv';
import * as syosetu from './syosetu';

export interface UnfurlHandler<T> {
    testUrl(url: URL): T | undefined;
    handle(bot: Client, discord: DiscordInfo, msg: Message, arg: T): Promise<void>;
}

export class Unfurler {
    private handlers: UnfurlHandler<any>[] = [];

    public addHandler<T>(handler: UnfurlHandler<T>) {
        this.handlers.push(handler);
    }

    public async tryUnfurl(bot: Client, discord: DiscordInfo, msg: Message, url: URL): Promise<boolean> {
        for (const handler of this.handlers) {
            const arg = handler.testUrl(url);
            if (arg != null) {
                await handler.handle(bot, discord, msg, arg);
                return true;
            }
        }
        return false;
    }
}

export function createUnfurler(): Unfurler {
    const unfurler = new Unfurler();
    unfurler.addHandler(pixiv.illustHandler);
    unfurler.addHandler(pixiv.userHandler);
    unfurler.addHandler(syosetu.infoHandler);
    return unfurler;
}
