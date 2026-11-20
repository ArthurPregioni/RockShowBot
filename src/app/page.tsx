import { requireChatGPTUser } from "../server/auth";
import {redirect} from "next/navigation";
import {settings} from "../server/bot";
import {purgeExpiredImports} from "../features/music/imports";
import Dashboard from "../components/dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  // Import sessions last ten minutes; opening the panel is the regular moment to drop expired ones.
  await purgeExpiredImports();
  const preferences=await settings();
  if(preferences.schedule.startsWith("migrated:"))redirect(preferences.schedule.slice(9));
  return <Dashboard displayName={user.displayName} email={user.email} />;
}
