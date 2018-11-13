import * as crypto from 'crypto';
import * as fs from 'fs';
import { URL } from 'url';
import * as qs from 'querystring';

import axios, { AxiosRequestConfig, AxiosResponse } from 'axios';
import * as cheerio from 'cheerio';
import { Cookie, CookieJar } from 'tough-cookie';

export class PixivLoginError extends Error {
}

export class PixivLoginFormatError extends Error {
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
        responseType: 'text',
    });

    private constructor(
        private jar: CookieJar,
    ) {
        this.axiosInstance.interceptors.request.use(this.interceptRequest);
        this.axiosInstance.interceptors.response.use(this.interceptResponse);
    }

    async saveSessionData(path: string): Promise<void> {
        const data = this.jar.serializeSync();
        await fs.promises.writeFile(path, data, 'utf8');
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
        return resp.data;
    }

    static async loginWithEncrypted(privateKey: string, cipher: Buffer): Promise<PixivSession> {
        const raw = crypto.privateDecrypt({ key: privateKey, passphrase: 'lumina' }, cipher);
        const cred = raw.toString();
        const [username, password] = cred.split(':').slice(1, 2);
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
        const data = await fs.promises.readFile(path, 'utf8');
        const jar = CookieJar.deserializeSync(data);
        return new PixivSession(jar);
    }
}
