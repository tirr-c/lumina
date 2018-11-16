import { processIllustRequest, processUserRequest } from '../handler/pixiv';
import { UnfurlHandler } from '.';

const illustHandler: UnfurlHandler<string> = {
    testUrl(url) {
        if (url.host !== 'www.pixiv.net' && url.host !== 'pixiv.net') {
            return undefined;
        }
        if (url.pathname === '/member_illust.php') {
            const illustId = url.searchParams.get('illust_id');
            if (illustId != null && /^\d+$/.test(illustId)) {
                return illustId;
            }
            return undefined;
        }
        const regex = /^\/i\/(\d+)$/.exec(url.pathname);
        if (regex != null) {
            return regex[1];
        }
        return undefined;
    },
    handle: processIllustRequest,
};

const userHandler: UnfurlHandler<string> = {
    testUrl(url) {
        if (url.host !== 'www.pixiv.net' && url.host !== 'pixiv.net') {
            return undefined;
        }
        if (url.pathname === '/member.php') {
            const id = url.searchParams.get('id');
            if (id != null && /^\d+$/.test(id)) {
                return id;
            }
            return undefined;
        }
        const regex = /^\/u\/(\d+)$/.exec(url.pathname);
        if (regex != null) {
            return regex[1];
        }
        return undefined;
    },
    handle: processUserRequest,
};

export {
    illustHandler,
    userHandler,
};
