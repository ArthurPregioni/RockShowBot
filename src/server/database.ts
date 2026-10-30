import {env} from "cloudflare:workers";
import {configuredOrigin} from "../core/config";

export function siteOrigin(){return configuredOrigin(env.ROCKSHOWBOT_SITE_ORIGIN,import.meta.env.DEV); }
export class UserError extends Error {constructor(message:string,public status=400){super(message);}}
export function database(){if(!env.DB)throw new Error("D1 unavailable");return env.DB;}
