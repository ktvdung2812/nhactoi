import { notFound } from "next/navigation";
import { isValidRoute } from "../../src/routes.js";

export const dynamic = "force-dynamic";
export const dynamicParams = true;

export default async function AppPage({ params }) {
  const resolved = await params;
  const slug = Array.isArray(resolved?.slug) ? resolved.slug : [];
  const pathname = `/${slug.join("/")}`;

  // The optional catchall keeps the client app mounted for every supported
  // page while still allowing Next to emit an actual HTTP 404 for typos.
  if (!isValidRoute(pathname)) notFound();

  // The client app lives in the root layout so changing a valid route keeps
  // its session, fetched data, open modal, and task return state mounted.
  return null;
}
