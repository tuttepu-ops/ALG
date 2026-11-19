import App from "@/client/App";

export default async function BrowserTest({ searchParams }: { searchParams: Promise<{ agent?: string }> }) {
  const agent = (await searchParams).agent === "gemini" ? "gemini" : undefined;
  return <><a className="alg-back" href="/">← ALG dashboard</a><App agent={agent} /></>;
}
