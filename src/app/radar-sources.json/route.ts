import catalog from "../../lib/radar-catalog.json";

export function GET() {
  return Response.json(catalog,{headers:{"Cache-Control":"public, max-age=1800"}});
}
