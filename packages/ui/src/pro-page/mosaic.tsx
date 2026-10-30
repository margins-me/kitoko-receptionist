import { coverPosition, coverSizes, PHOTO_SIZES } from "./model";
import { PhotoViewer } from "./photo-viewer";
import type { PageCover, PageImage } from "./types";

/** Tiles in the mosaic: 1 large, 4 small. */
const TILES = 5;

export type MosaicProps = {
  cover: PageCover | null;
  photos: PageImage[];
  /** "Photos de Nala": the list's name, and the cover tile's (the cover has no alt of its own). */
  label: string;
  /** "Voir les # photos" over the last tile; none draws a plain tile. */
  allPhotos?: string;
  closeLabel: string;
};

/**
 * Encadré on desktop once her gallery has MOSAIC_MIN photos: the cover (else her first photo) large, the next four
 * small, every tile opening the fullscreen viewer on itself; the last says how many there are in all. The viewer
 * shows the cover too, so every tile is in it and the count is what it shows. Hidden on phones, where the swiped strip
 * stays: its images load lazily, so phones fetch none of them (the cover keeps the strip's `sizes`, one download).
 */
export function Mosaic({ cover, photos, label, allPhotos, closeLabel }: MosaicProps) {
  const all: PageImage[] = [...(cover ? [cover.image] : []), ...photos];
  const tiles = all.slice(0, TILES);
  const more = allPhotos?.replace("#", String(all.length));
  return (
    <PhotoViewer photos={all} closeLabel={closeLabel} className="hidden @desk:block">
      <ul aria-label={label} className="grid h-[380px] grid-cols-4 grid-rows-2 gap-2.5">
        {tiles.map((photo, i) => {
          const large = i === 0;
          const last = i === tiles.length - 1;
          const isCover = large && cover !== null;
          return (
            <li key={photo.src} className={large ? "col-span-2 row-span-2" : undefined}>
              {/* The button clips the photo, so the focus ring draws around it, in the grid's gap. */}
              <button
                type="button"
                data-photo={last && more ? 0 : i}
                aria-label={last && more ? more : isCover ? label : undefined}
                className="relative block size-full cursor-zoom-in overflow-hidden rounded-pp-photo-desk bg-page-chip"
              >
                <img
                  src={photo.src}
                  srcSet={photo.srcSet}
                  // The large tile is about the cover's width (its `sizes`, so a cover is one download); small ones the grid's.
                  sizes={large ? coverSizes("encadre") : PHOTO_SIZES.grid}
                  width={photo.width}
                  height={photo.height}
                  alt={isCover ? "" : photo.alt}
                  loading="lazy"
                  decoding="async"
                  className="size-full object-cover"
                  // Runtime value: her focal point on the cover.
                  style={isCover ? { objectPosition: coverPosition(cover.focalX, cover.focalY) } : undefined}
                />
                {last && more && (
                  <span aria-hidden className="absolute inset-0 grid place-items-center bg-photo-scrim/60 px-3 text-center text-ui font-semibold text-on-photo">
                    {more}
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </PhotoViewer>
  );
}
