import {requireChatGPTUser} from '../../chatgpt-auth';
import BrowserImport from './browser-import';
export const dynamic='force-dynamic';
export default async function Page(){
  await requireChatGPTUser('/music/browser-import');
  return <BrowserImport/>;
}
