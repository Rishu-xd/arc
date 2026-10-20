"use client";

import Image from "next/image";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { ScrapedWebsiteResult } from "../scraping/types";

export type ScrapedResultNodeData = {
  scrapedResult: ScrapedWebsiteResult;
};

export function ScrapedResultNodeView({ data }: NodeProps<Node<ScrapedResultNodeData>>) {
  const { scrapedResult } = data;

  return (
    <article className="relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-[#35313f] bg-[#191820] shadow-[0_16px_48px_rgb(0_0_0_/_35%)]">
      <Handle
        className="!top-[-5px] !h-[9px] !w-[9px] !border-2 !border-[#191820] !bg-[#a18de9]"
        id="scraped-result-input"
        position={Position.Top}
        type="target"
      />
      <Handle
        className="!bottom-[-5px] !top-auto !h-[9px] !w-[9px] !border-2 !border-[#191820] !bg-[#a18de9]"
        id="scraped-result-output"
        position={Position.Bottom}
        type="source"
      />
      <a
        aria-label={`Visit ${scrapedResult.title} on ${scrapedResult.siteName}`}
        className="nodrag nopan relative flex h-[116px] shrink-0 items-center justify-center overflow-hidden bg-[radial-gradient(ellipse_at_center,_#282532,_#15151b_75%)] p-3"
        href={scrapedResult.pageUrl}
        rel="noreferrer"
        target="_blank"
      >
        {scrapedResult.imageUrl ? (
          <Image
            alt={scrapedResult.title}
            className="h-full w-full object-contain"
            height={116}
            loading="lazy"
            src={scrapedResult.imageUrl}
            unoptimized
            width={300}
          />
        ) : (
          <span className="text-3xl text-[#7c718f]" aria-hidden="true">◇</span>
        )}
        <span className="absolute top-3 left-3 max-w-[80%] truncate rounded-md border border-white/10 bg-black/35 px-2 py-1 text-[9px] font-semibold tracking-wide text-[#e8e1f5]">
          {scrapedResult.siteName.toUpperCase()}
        </span>
      </a>
      <div className="flex min-h-0 flex-1 flex-col px-3.5 pt-3 pb-3">
        <h3
          className="m-0 line-clamp-2 text-[12px] font-semibold leading-[17px] text-[#f0eff5]"
          title={scrapedResult.title}
        >
          {scrapedResult.title}
        </h3>
        <p className="mt-1.5 mb-0 line-clamp-2 text-[10px] leading-[15px] text-[#92909f]">
          {scrapedResult.description}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <div className="min-w-0">
            <p className="m-0 text-[8px] font-medium uppercase tracking-[0.12em] text-[#817f8d]">
              {scrapedResult.price ? "Listed price" : "Price"}
            </p>
            <p className="mt-0.5 mb-0 truncate text-[17px] font-bold tracking-tight text-[#d5c9ff]">
              {scrapedResult.price ?? "Not found"}
            </p>
          </div>
          <a
            className="nodrag nopan inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#765bd8] px-3 py-2 text-[10px] font-semibold text-white transition-colors hover:bg-[#876de7]"
            href={scrapedResult.pageUrl}
            rel="noreferrer"
            target="_blank"
          >
            Visit {scrapedResult.siteName} <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </article>
  );
}
