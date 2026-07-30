import type { Metadata } from "next";
import { cookies } from "next/headers";
import { PipelineControl } from "@/components/pipeline-control";
import { LogoutButton } from "@/components/logout-button";
import { COOKIE_NAME, verifyToken } from "@/lib/auth";

export const metadata: Metadata = { title: "Pipeline — lovable-parser" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const jar = await cookies();
  const authed = await verifyToken(jar.get(COOKIE_NAME)?.value);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            Pipeline
            {authed && (
              <span
                className="h-2 w-2 rounded-full bg-ok"
                title="Session authenticated — actions run the real pipeline"
              />
            )}
          </h1>
          <p className="mt-1 text-sm text-ink-2">
            Run the stages in order: refresh domain data → generate
            screenshots → score. Each stage is resumable and safe to re-run.
          </p>
        </div>
        {authed && <LogoutButton />}
      </div>
      <PipelineControl authed={authed} />
    </div>
  );
}
