import { requireChatGPTUser } from "../server/auth";
import {redirect} from "next/navigation";
import {settings} from "../server/bot";
import Dashboard from "../components/dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  const preferences=await settings();
  if(preferences.schedule.startsWith("migrated:"))redirect(preferences.schedule.slice(9));
  return <Dashboard displayName={user.displayName} email={user.email} />;
}
