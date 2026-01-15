"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";

type VibixPlayerType = "movie" | "series" | "kp" | "imdb";

type VibixRendexPlayerProps = {
  publisherId: string;
  type: VibixPlayerType;
  id: string;
  title: string;
  fallbackIframeUrl: string;
  posterSrc?: string | null;
};

export function VibixRendexPlayer({
  publisherId,
  type,
  id,
  title,
  fallbackIframeUrl,
  posterSrc,
}: VibixRendexPlayerProps) {
  const insRef = useRef<HTMLModElement | null>(null);
  const [showFallback, setShowFallback] = useState(true);
  const [iframeLoaded, setIframeLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let t1: number | null = null;

    let observer: MutationObserver | null = null;

    setShowFallback(true);
    setIframeLoaded(false);

    try {
      (window as any)?.rendex?.init?.();
      (window as any)?.rendex?.scan?.();
      (window as any)?.Rendex?.init?.();
      (window as any)?.Rendex?.scan?.();
      (window as any)?.RendexSDK?.init?.();
      (window as any)?.RendexSDK?.scan?.();
    } catch {
    }

    try {
      window.dispatchEvent(new Event("DOMContentLoaded"));
      window.dispatchEvent(new Event("load"));
    } catch {
    }

    const el = insRef.current;
    if (el && typeof MutationObserver !== "undefined") {
      observer = new MutationObserver(() => {
        if (cancelled) return;
        const hasIframe = !!el.querySelector("iframe");
        const hasChildren = el.childElementCount > 0;
        if (hasIframe || hasChildren) {
          setShowFallback(false);
        }
      });
      observer.observe(el, { childList: true, subtree: true });
    }

    t1 = window.setTimeout(() => {
      if (cancelled) return;
      const node = insRef.current;
      const hasIframe = !!node?.querySelector?.("iframe");
      const hasChildren = (node?.childElementCount ?? 0) > 0;
      if (hasIframe || hasChildren) setShowFallback(false);
    }, 900);

    return () => {
      cancelled = true;
      if (t1 != null) window.clearTimeout(t1);
      observer?.disconnect();
    };
  }, [id, type]);

  const showPlaceholder = !!posterSrc && showFallback && !iframeLoaded;

  return (
    <>
      {showPlaceholder ? (
        <div className="absolute inset-0">
          <Image
            src={posterSrc as string}
            alt={title}
            fill
            unoptimized
            className="object-cover opacity-50"
            sizes="(min-width: 640px) 1024px, 100vw"
          />
          <div className="absolute inset-0 bg-black/50" />
        </div>
      ) : null}
      <ins
        ref={insRef}
        data-publisher-id={publisherId}
        data-type={type}
        data-id={id}
        className="absolute inset-0 block h-full w-full"
      />
      {showFallback ? (
        <iframe
          src={fallbackIframeUrl}
          className="absolute inset-0 h-full w-full"
          allow="autoplay; fullscreen; picture-in-picture"
          allowFullScreen
          title={title}
          onLoad={() => setIframeLoaded(true)}
        />
      ) : null}
    </>
  );
}
