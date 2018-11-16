import axios from 'axios';
import * as cheerio from 'cheerio';
import * as Hjson from 'hjson';

const KEYS = ['cai', 'pm10', 'pm2.5', 'o3', 'no2', 'co', 'so2'];

function fillEmptyData(str: string) {
    const regexp = /,,/g;
    while (true) {
        const x = str.replace(regexp, ',null,');
        if (str === x) break;
        str = x;
    }
    return str;
}

type AirkoreaDataRow = [
    string, number | null,
    number | null, string,
    number | null, string,
    number | null, string,
    number | null, string
];

export interface AirStatus {
    stationName: string;
    time: string;
    data: Map<string, string[]>;
}

export async function getAirStatus(lat: string, lng: string): Promise<AirStatus> {
    const regexp = /addRows\((\[.*\])\);/g;
    const resp = await axios.get(
        'http://m.airkorea.or.kr/main',
        {
            params: {
                lat,
                lng,
                deviceId: '1234',
            },
        },
    );

    const html = resp.data;
    let idx = 0;
    let match;
    const data = new Map();
    while ((match = regexp.exec(html)) != null) {
        const raw = fillEmptyData(match[1]);
        const arr: AirkoreaDataRow[] = Hjson.parse(raw);
        const key = KEYS[idx];
        if (key == null) {
            console.warn(`getAirStatus: result is more than ${KEYS.length}`);
            break;
        }
        const values = arr.map(row => row[3] || row[5] || row[7] || row[9]).filter(x => x !== '');
        data.set(key, values);
        idx++;
    }

    const $ = cheerio.load(html);
    $('h1 > .tit > .ts').text('');
    const stationName = $('h1 > .tit').text().trim();
    const time = $('h1 > .tim').text().trim();

    return { stationName, time, data };
}
