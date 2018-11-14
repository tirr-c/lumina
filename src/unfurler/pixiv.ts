import { processIllustRequest } from '../handler/pixiv';
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

export {
    illustHandler,
};
