"use client";

import { useEffect, useState } from "react";
import Header from "./Header";

// Client-side shell for pages that don't already render the header server-side.
export default function PageShell({ children }: { children: React.ReactNode }) {
  const [name, setName] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then(async (r) => {
        if (r.ok) {
          const s = await r.json();
          setName(s.name ?? "");
        }
      })
      .catch(() => {});
  }, []);

  return (
    <>
      <Header userName={name} />
      {children}
    </>
  );
}
