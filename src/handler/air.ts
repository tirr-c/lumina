import { Client, Message } from 'eris';

import { getAirStatus } from '../air';
import { KakaoAPI, LocationNotFoundError } from '../kakao';

const PM10_STOPS = [30, 80, 150, Infinity];
const PM25_STOPS = [15, 35, 75, Infinity];
const STATUS_STRING = ['좋음', '보통', '나쁨', '매우 나쁨'];

function formatPM(pm: string[] | undefined, stops: number[]) {
    if (pm == null) {
        return '(정보 없음)';
    }

    const pmBefore = pm.slice(pm.length - 6, pm.length - 1).map(x => `${x} →`);
    const pmCurrent = parseInt(pm[pm.length - 1]);

    let idx = 0;
    while (stops[idx] <= pmCurrent) {
        idx++;
    }
    const currentStatus = STATUS_STRING[idx];

    return `${pmBefore.join(' ')} **${pmCurrent}** (${currentStatus})`;
}

export interface AirQueryArgs {
    kakaoToken: string;
    query: string;
}

export async function handleAirQuery(bot: Client, msg: Message, arg: AirQueryArgs) {
    try {
        const kakao = new KakaoAPI(arg.kakaoToken);
        const location = await kakao.searchLocation(arg.query);
        const airStatus = await getAirStatus(location.lat, location.lng);

        const header =
            `**${location.name}**에서 가장 가까운 **${airStatus.stationName}**의 정보입니다. (${airStatus.time})`;
        const pm10Info = `PM10 (\u338d/\u33a5): ${formatPM(airStatus.data.get('pm10'), PM10_STOPS)}`;
        const pm25Info = `PM2.5 (\u338d/\u33a5): ${formatPM(airStatus.data.get('pm2.5'), PM25_STOPS)}`;
        const content = `${header}\n\n${pm10Info}\n${pm25Info}`;

        await bot.createMessage(
            msg.channel.id,
            content,
        );
    } catch (err) {
        if (err instanceof LocationNotFoundError) {
            await bot.createMessage(
                msg.channel.id,
                ':x: 주소를 찾을 수 없어요.',
            );
        } else {
            throw err;
        }
    }
}
