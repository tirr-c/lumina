import axios from 'axios';
import * as cheerio from 'cheerio';

export interface SyosetuInfo {
    ncode: string;
    title: string;
    author: { name: string; url: string; };
    synopsis: string;
    parts: number;
    end: boolean;
}

const PARTS_REGEX = /全(\d+)部分/;

export async function fetchSyosetuInfo(ncode: string): Promise<SyosetuInfo> {
    const ret = await axios.get(`https://ncode.syosetu.com/novelview/infotop/ncode/${ncode}/`);
    const $ = cheerio.load(ret.data);

    const title = $('h1').text().trim();
    const authorLink = $('#noveltable1 tr:nth-child(2) > td > a');
    const authorName = authorLink.text().trim();
    const authorUrl = authorLink.attr('href');
    const synopsis = $('#noveltable1 tr:nth-child(1) > td').text().trim();

    const partsMatch = PARTS_REGEX.exec($('#pre_info').text());
    const parts = partsMatch == null ? 0 : Number(partsMatch[1]);

    const end = $('#noveltype_notend').length === 0;

    return {
        ncode,
        title,
        author: {
            name: authorName,
            url: authorUrl,
        },
        synopsis,
        parts,
        end,
    };
}
