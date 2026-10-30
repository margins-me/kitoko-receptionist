"use client";

import { useEffect, useState } from "react";
import type { ChangeEvent, InputHTMLAttributes } from "react";
import { ImagePlus } from "lucide-react";
import { cn } from "./cn";

export type PhotoUploadProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange"> & {
  label: string;
  hint?: string;
  /** Texts once a photo is picked, e.g. "Photo d'inspiration ajoutée". */
  doneLabel: string;
  doneHint?: string;
  onFileChange?: (file: File | null) => void;
};

/** Dashed tile around a file input with a local preview. Uploading is the caller's job. */
export function PhotoUpload({ label, hint, doneLabel, doneHint, onFileChange, accept = "image/*", className, ...rest }: PhotoUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const change = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setPreview(file ? URL.createObjectURL(file) : null);
    onFileChange?.(file);
  };

  return (
    <label
      className={cn(
        "flex min-h-15 items-center gap-3 rounded-chip border-[1.5px] border-dashed border-field bg-surface px-3.5 py-2.5 text-left",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
        preview && "border-solid border-ink",
        className,
      )}
    >
      <input type="file" accept={accept} className="sr-only" onChange={change} {...rest} />
      <span aria-hidden className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px] bg-soft text-muted">
        {preview ? <img src={preview} alt="" className="size-full object-cover" /> : <ImagePlus className="size-5" strokeWidth={1.8} />}
      </span>
      <span className="flex flex-col">
        <strong className="text-ui font-semibold">{preview ? doneLabel : label}</strong>
        {(preview ? doneHint : hint) && <span className="text-caption text-muted">{preview ? doneHint : hint}</span>}
      </span>
    </label>
  );
}
