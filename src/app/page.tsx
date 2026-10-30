import { requireChatGPTUser } from "../server/auth";
import Dashboard from "../components/dashboard";
export const dynamic = "force-dynamic";
export default async function Home() {
  const user = await requireChatGPTUser("/");
  return <Dashboard displayName={user.displayName} email={user.email} />;
}
