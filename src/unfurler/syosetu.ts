import { processSyosetuInfo } from '../handler/syosetu';
import { UnfurlHandler } from '.';

const NCODE_MATCH = /n\d{4}[a-z]{2}/;

export const infoHandler: UnfurlHandler<string> = {
    testUrl(url) {
        if (url.host !== 'ncode.syosetu.com') {
            return undefined;
        }
        const ncodeMatch = NCODE_MATCH.exec(url.pathname);
        if (ncodeMatch == null) {
            return undefined;
        }
        return ncodeMatch[0];
    },
    handle: processSyosetuInfo,
};
