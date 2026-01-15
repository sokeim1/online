"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Image from "next/image";

type PosterLightboxProps = {
  src: string;
  alt: string;
};

export function PosterLightbox({ src, alt }: PosterLightboxProps) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };

    document.addEventListener("keydown", onKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="absolute inset-0"
        aria-label="Открыть постер"
      />

      {open && mounted
        ? createPortal(
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4"
              onMouseDown={() => setOpen(false)}
              role="dialog"
              aria-modal="true"
            >
              <div
                className="relative max-h-[90vh] max-w-[90vw]"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <Image
                  src={src}
                  alt={alt}
                  width={1200}
                  height={1800}
                  unoptimized
                  className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain"
                />
                <div className="mt-4 flex justify-center">
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-xl bg-white px-6 py-2 text-sm font-semibold text-black"
                  >
                    Закрыть
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
