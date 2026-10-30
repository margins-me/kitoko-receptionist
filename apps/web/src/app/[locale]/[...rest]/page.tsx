import { notFound } from "next/navigation";

// Unmatched deeper paths (/a/b) would get Next's bare 404; send them to ../not-found.tsx instead.
export default function CatchAll() {
  notFound();
}
