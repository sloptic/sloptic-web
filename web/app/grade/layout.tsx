import type { Metadata } from "next";

/** robots.txt asks crawlers not to fetch these; this tells the ones that fetch anyway (and anything
 *  that follows a shared link) not to index or archive what they find. The page itself is a client
 *  component and cannot export metadata, so it hangs here. */
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

export default function GradeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
