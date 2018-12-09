import axios from 'axios';
import * as cheerio from 'cheerio';

export const enum NovelType {
    Long = 1,
    Short = 2,
}

export interface SyosetuInfo {
    ncode: string;
    title: string;
    author: { id: number; name: string; };
    synopsis: string;
    parts: number;
    type: NovelType;
    end: boolean;
}

export class SyosetuNotFoundError extends Error {
}

const PARTS_REGEX = /全(\d+)部分/;

export async function fetchSyosetuInfo(ncode: string): Promise<SyosetuInfo> {
    const ret = await axios.get(
        'https://api.syosetu.com/novelapi/api/',
        {
            params: {
                out: 'json',
                libtype: 2,
                of: 't-u-w-s-nt-e-ga',
                ncode,
            },
        },
    );
    if (ret.data[0] == null || ret.data[0].allcount <= 0) {
        throw new SyosetuNotFoundError();
    }
    const rawData = ret.data[1];

    return {
        ncode,
        title: rawData.title,
        author: {
            id: rawData.userid,
            name: rawData.writer,
        },
        synopsis: rawData.story,
        parts: rawData.general_all_no,
        type: rawData.noveltype as NovelType,
        end: rawData.end === 0,
    };
}
