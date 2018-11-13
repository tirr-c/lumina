import * as crypto from 'crypto';
import * as fs from 'fs';
import { URL } from 'url';
import * as qs from 'querystring';

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import * as dateFns from 'date-fns';
import * as Hjson from 'hjson';
import { Cookie, CookieJar } from 'tough-cookie';

export class DecryptError extends Error {
}

export class PixivLoginError extends Error {
}

export class PixivLoginFormatError extends Error {
}

export class DataError extends Error {
}

export class NotLoggedInError extends Error {
}

export class NotFoundError extends Error {
}

export interface Response<T> {
    error: boolean;
    message: string;
    body: T;
}

// Not complete
export interface User {
    userId: string;
    name: string;
    image: string;
    imageBig: string;
}

export interface IllustUrls {
    mini: string;
    thumb: string;
    small: string;
    regular: string;
    original: string;
}

export interface Illust {
    id: string;
    title: string;
    description: string;
    illustType: number;
    createDate: Date;
    uploadDate: Date;
    restrict: number;
    xRestrict: number;
    urls: IllustUrls;
    userId: string;
    userName: string;
    userAccount: string;
    width: number;
    height: number;
    pageCount: number;
}

export class PixivSession {
    private interceptRequest = (config: AxiosRequestConfig) => {
        const url = new URL(config.url!, config.baseURL).toString();
        const cookie = this.jar.getCookieStringSync(url);
        if (typeof config.headers !== 'object') {
            return {
                ...config,
                headers: { cookie },
            };
        } else {
            return {
                ...config,
                headers: {
                    ...config.headers,
                    cookie,
                },
            }
        }
    };

    private interceptResponse = (response: AxiosResponse) => {
        const url = new URL(response.config.url!, response.config.baseURL).toString();
        const setCookie = response.headers['set-cookie'];
        let cookies: Cookie[];
        if (setCookie instanceof Array) {
            cookies = setCookie.map(cookie => Cookie.parse(cookie)!).filter(x => x != null);
        } else if (setCookie != null) {
            const cookie = Cookie.parse(setCookie);
            if (cookie != null) {
                cookies = [cookie];
            } else {
                cookies = [];
            }
        } else {
            cookies = [];
        }
        for (const cookie of cookies) {
            this.jar.setCookieSync(cookie, url);
        }
        return response;
    };

    private axiosInstance = axios.create({
        paramsSerializer: qs.stringify,
    });

    private token: string | undefined;

    private constructor(
        private jar: CookieJar,
    ) {
        this.axiosInstance.interceptors.request.use(this.interceptRequest);
        this.axiosInstance.interceptors.response.use(this.interceptResponse);
    }

    async saveSessionData(path: string): Promise<void> {
        const data = this.jar.serializeSync();
        await fs.promises.writeFile(path, JSON.stringify(data), 'utf8');
    }

    async getUser(userId: string): Promise<User> {
        try {
            const resp = await this.axiosInstance.get(`https://www.pixiv.net/u/${userId}`);
            const regex = /\)\((\{.*)\})\);/.exec(resp.data);
            if (regex == null) {
                throw new DataError();
            }
            return Hjson.parse(regex[1]).preload.user[userId];
        } catch (_err) {
            throw new NotFoundError();
        }
    }

    async getIllustInfo(illustId: string): Promise<Illust> {
        try {
            const resp = await this.axiosInstance.get(`https://www.pixiv.net/ajax/illust/${illustId}`);
            const ret = { ...resp.data.body };
            ret.description = cheerio.load(ret.description)(':root').text();
            ret.createDate = dateFns.parse(ret.createDate);
            ret.uploadDate = dateFns.parse(ret.uploadDate);
            return ret;
        } catch (_err) {
            throw new NotFoundError();
        }
    }

    async downloadWithReferer(url: string, referer: string): Promise<Buffer> {
        try {
            const resp = await this.axiosInstance.get(
                url,
                {
                    headers: { referer },
                    responseType: 'arraybuffer',
                },
            );
            return resp.data;
        } catch (_err) {
            throw new NotFoundError();
        }
    }

    private async getToken(): Promise<string> {
        const resp = await this.axiosInstance.get('https://www.pixiv.net/');
        const regex = /pixiv\.context\.token\s*=\s*"([0-9a-f]*)"/.exec(resp.data);
        if (regex == null) {
            throw new NotLoggedInError();
        }
        return regex[1];
    }

    private async getPostKey(): Promise<string> {
        const resp = await this.axiosInstance.get('https://accounts.pixiv.net/login');
        const $ = cheerio.load(resp.data);
        return $('input[name="post_key"]').attr('value');
    }

    private async login(username: string, password: string): Promise<any> {
        const payload = {
            captcha: '',
            g_captcha_response: '',
            post_key: await this.getPostKey(),
            pixiv_id: username,
            password,
            source: 'accounts',
            ref: '',
            return_to: 'https://www.pixiv.net/',
        };
        const resp = await this.axiosInstance.post(
            'https://accounts.pixiv.net/api/login?lang=ja',
            qs.stringify(payload),
            {
                headers: {
                    'accept': 'application/json',
                    'content-type': 'application/x-www-form-urlencoded',
                },
                withCredentials: true,
            },
        );
        this.token = await this.getToken();
        return resp.data;
    }

    static async loginWithEncrypted(privateKey: string, cipher: Buffer): Promise<PixivSession> {
        let raw;
        try {
            raw = crypto.privateDecrypt({ key: privateKey, passphrase: 'lumina' }, cipher);
        } catch (_err) {
            throw new DecryptError();
        }
        const cred = raw.toString();
        const [username, password] = cred.split(':').slice(1, 3);
        if (username == null || password == null) {
            throw new PixivLoginFormatError();
        }

        const jar = new CookieJar();
        const session = new PixivSession(jar);
        try {
            await session.login(username, password);
        } catch (_err) {
            throw new PixivLoginError();
        }
        return session;
    }

    static async fromSessionData(path: string): Promise<PixivSession> {
        let data;
        try {
            data = await fs.promises.readFile(path, 'utf8');
        } catch (_err) {
            throw new NotLoggedInError();
        }
        const jar = CookieJar.deserializeSync(data);
        const session = new PixivSession(jar);
        session.token = await session.getToken();
        return session;
    }
}
