import * as path from 'path';

export const home = process.env['LUMINA_HOME'] || '/var/lib/lumina';
export const privateKeyPath = path.join(home, 'rsa');
export const publicKeyPath = path.join(home, 'rsa.pub');
export const discordInfoPath = path.join(home, 'discord.json');
export const pixivSessionPath = path.join(home, 'pixiv.json');
export const noticePath = path.join(home, 'notices');
