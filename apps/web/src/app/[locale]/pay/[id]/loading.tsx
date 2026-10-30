import { Skeleton } from "@kitoko/ui";

// The deposit page's outline while its booking loads: same column, same blocks, so nothing jumps when it arrives.
export default function PayLoading() {
  return (
    <main aria-busy className="mx-auto flex min-h-dvh w-full max-w-140 flex-col gap-4 px-4 pt-2 pb-10 desk:pt-8">
      <div className="flex min-h-11 items-center">
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-5 w-full" />
      </div>
      <Skeleton className="h-13 w-full rounded-input" />
      <Skeleton className="h-72 w-full rounded-ticket" />
      <Skeleton className="h-52 w-full rounded-card" />
    </main>
  );
}
