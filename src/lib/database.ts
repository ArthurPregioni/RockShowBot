import {env} from "cloudflare:workers";

export const SITE_ORIGIN=(env.ROCKSHOWBOT_SITE_ORIGIN||"https://rockshowbot-arthur.socialyak11.chatgpt.site").replace(/\/+$/,"");
export class UserError extends Error {constructor(message:string,public status=400){super(message);}}
export function database(){if(!env.DB)throw new Error("D1 unavailable");return env.DB;}
