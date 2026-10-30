"use client";

import type { ComponentProps } from "react";
import { Tabs as RadixTabs } from "radix-ui";
import { cn } from "./cn";

export const Tabs = RadixTabs.Root;

export function TabsList({ sticky, className, ...rest }: ComponentProps<typeof RadixTabs.List> & { sticky?: boolean }) {
  return (
    <RadixTabs.List
      className={cn(
        "flex min-h-13 gap-0.5 overflow-x-auto overflow-y-hidden border-b border-hairline bg-surface px-3 [scrollbar-width:none] *:shrink-0",
        sticky && "sticky top-0 z-10",
        className,
      )}
      {...rest}
    />
  );
}

export function TabsTrigger({ className, ...rest }: ComponentProps<typeof RadixTabs.Trigger>) {
  return (
    <RadixTabs.Trigger
      className={cn(
        "-mb-px min-h-12.5 border-b-[2.5px] border-transparent px-2.5 text-ui font-medium whitespace-nowrap text-muted focus-visible:-outline-offset-2",
        "data-[state=active]:border-ink data-[state=active]:font-bold data-[state=active]:text-ink",
        className,
      )}
      {...rest}
    />
  );
}

export function TabsContent({ className, ...rest }: ComponentProps<typeof RadixTabs.Content>) {
  return <RadixTabs.Content className={cn("focus-visible:outline-offset-4", className)} {...rest} />;
}
