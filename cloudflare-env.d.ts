declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    APPLE_MUSIC_DEVELOPER_TOKEN?: string;
    TICKETMASTER_API_KEY?: string;
    PREDICTHQ_API_KEY?: string;
  }
}
