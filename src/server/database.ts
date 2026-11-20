import {env} from "cloudflare:workers";
import {configuredOrigin} from "../core/config";

export function siteOrigin(){return configuredOrigin(env.ROCKSHOWBOT_SITE_ORIGIN,import.meta.env.DEV||import.meta.env.ROCKSHOWBOT_STANDALONE==="true"); }
// Plain field instead of a parameter property, so Node's own type stripping can load this file in tests.
export class UserError extends Error {status:number;constructor(message:string,status=400){super(message);this.status=status;}}
export function database(){if(!env.DB)throw new Error("D1 unavailable");return env.DB;}
