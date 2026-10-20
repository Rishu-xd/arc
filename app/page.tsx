"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScrapedWebsiteResult } from "@/scraping/types";
import { ScrapedResultNodeView, type ScrapedResultNodeData } from "@/ui/ScrapedResultNode";
import {
  Handle,
  Position,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";

type ChatDockData = {
  isLoading: boolean;
  selectedContext?: SelectedNodeContext;
  onSubmit: (prompt: string, context?: SelectedNodeContext) => Promise<void>;
  onClearContext: () => void;
};

type SelectedNodeContext = {
  nodeId: string;
  nodeType: "response" | "image" | "workflowStep" | "scrapedResult";
  label: string;
  details: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ResponseData = {
  onToggleExpand: () => void;
  prompt: string;
  response: string;
  status: "loading" | "success" | "error";
  generationTimeMs?: number;
  isExpanded: boolean;
  historyCount: number;
  onShowHistory: () => void;
  images: ImageAsset[];
  imageError?: string;
};

type ProcessData = {
  label: string;
  status: "active" | "done" | "error";
  logs: string[];
  onShowLogs: () => void;
};

type ImageAsset = {
  thumbnailUrl: string;
  sourceUrl: string;
  title: string;
  artist: string;
  license: string;
  width: number;
  height: number;
};

type ImageNodeData = { image: ImageAsset };
type ComparisonData = {
  products: { nodeId: string; scrapedResult: ScrapedWebsiteResult }[];
};
type CanvasNodeData =
  | ChatDockData
  | ResponseData
  | ImageNodeData
  | ProcessData
  | ComparisonData
  | ScrapedResultNodeData;
type CanvasNode = Node<CanvasNodeData>;

const DOCK_HEIGHT = 132;
const RESPONSE_WIDTH = 360;
const RESPONSE_HEIGHT = 172;
const RESPONSE_EXPANDED_HEIGHT = 360;
const IMAGE_WIDTH = 220;
const IMAGE_HEIGHT = 132;
const IMAGE_GAP = 12;
const RESULT_WIDTH = 336;
const RESULT_HEIGHT = 260;
const PROCESS_HEIGHT = 64;
const COMPARISON_HEIGHT = 180;

function getDockWidth(canvasWidth: number) {
  return Math.max(200, Math.min(560, canvasWidth - 32));
}

function getNodeContext(node: CanvasNode): SelectedNodeContext | undefined {
  if ("image" in node.data) {
    const image = node.data.image;
    return {
      nodeId: node.id,
      nodeType: "image",
      label: image.title,
      details: [
        `Image title: ${image.title}`,
        `Artist: ${image.artist}`,
        `License: ${image.license}`,
        `Dimensions: ${image.width}×${image.height}`,
        `Thumbnail URL: ${image.thumbnailUrl}`,
        `Wikimedia Commons page: ${image.sourceUrl}`,
      ].join("\n"),
    };
  }
  if ("scrapedResult" in node.data) {
    const scrapedResult = node.data.scrapedResult;
    return {
      nodeId: node.id,
      nodeType: "scrapedResult",
      label: `${scrapedResult.siteName}: ${scrapedResult.title}`,
      details: [
        `Site: ${scrapedResult.siteName}`,
        `Title: ${scrapedResult.title}`,
        `Price: ${scrapedResult.price ?? "Not found on the page"}`,
        `Description: ${scrapedResult.description}`,
        `Page: ${scrapedResult.pageUrl}`,
      ].join("\n"),
    };
  }
  if ("products" in node.data) {
    return {
      nodeId: node.id,
      nodeType: "workflowStep",
      label: "Product comparison",
      details: node.data.products
        .map(({ scrapedResult }) => `${scrapedResult.title}: ${scrapedResult.price ?? "Price not found"}\n${scrapedResult.description}`)
        .join("\n\n"),
    };
  }
  if ("label" in node.data) {
    return {
      nodeId: node.id,
      nodeType: "workflowStep",
      label: node.data.label,
      details: `Workflow step: ${node.data.label}\nCurrent status: ${node.data.status}`,
    };
  }
  if ("prompt" in node.data) {
    const response = node.data.response || "No response has been generated yet.";
    return {
      nodeId: node.id,
      nodeType: "response",
      label: "Arc response",
      details: [
        `Original request: ${node.data.prompt}`,
        `Response status: ${node.data.status}`,
        `Response: ${response}`,
        `Images attached: ${node.data.images.length}`,
        ...node.data.images.map(
          (image, index) =>
            `Image ${index + 1}: ${image.title}; artist: ${image.artist}; license: ${image.license}; source: ${image.sourceUrl}`,
        ),
      ].join("\n"),
    };
  }
  return undefined;
}

function isComparisonRequest(prompt: string) {
  return /\b(compare|comparison|versus|vs\.?|better than|which one)\b/i.test(prompt);
}

function isProcessData(data: CanvasNodeData): data is ProcessData {
  return (
    "logs" in data &&
    "label" in data &&
    "status" in data &&
    "onShowLogs" in data
  );
}

function getDockPosition(width: number, height: number) {
  const dockWidth = getDockWidth(width);

  return {
    x: Math.max(16, (width - dockWidth) / 2),
    y: Math.max(16, height - DOCK_HEIGHT - 28),
  };
}

function isImageAsset(value: unknown): value is ImageAsset {
  if (typeof value !== "object" || value === null) return false;
  const image = value as Record<string, unknown>;
  if (
    typeof image.thumbnailUrl !== "string" ||
    typeof image.sourceUrl !== "string" ||
    typeof image.title !== "string" ||
    typeof image.artist !== "string" ||
    typeof image.license !== "string" ||
    typeof image.width !== "number" ||
    typeof image.height !== "number"
  ) {
    return false;
  }

  try {
    const thumbnailUrl = new URL(image.thumbnailUrl);
    const sourceUrl = new URL(image.sourceUrl);
    return (
      thumbnailUrl.protocol === "https:" &&
      ["thumb.wikimedia.org", "upload.wikimedia.org"].includes(thumbnailUrl.hostname) &&
      sourceUrl.protocol === "https:" &&
      sourceUrl.hostname === "commons.wikimedia.org"
    );
  } catch {
    return false;
  }
}

function isScrapedWebsiteResult(value: unknown): value is ScrapedWebsiteResult {
  if (typeof value !== "object" || value === null) return false;
  const result = value as Record<string, unknown>;
  if (
    typeof result.siteName !== "string" ||
    typeof result.title !== "string" ||
    (result.price !== undefined && typeof result.price !== "string") ||
    typeof result.description !== "string" ||
    typeof result.pageUrl !== "string" ||
    (result.imageUrl !== undefined && typeof result.imageUrl !== "string")
  ) {
    return false;
  }

  try {
    const pageUrl = new URL(result.pageUrl);
    if (
      !["https:", "http:"].includes(pageUrl.protocol) ||
      !pageUrl.hostname ||
      pageUrl.username ||
      pageUrl.password ||
      pageUrl.port ||
      pageUrl.hostname === "localhost" ||
      pageUrl.hostname.endsWith(".localhost") ||
      pageUrl.hostname.endsWith(".local") ||
      pageUrl.hostname.endsWith(".internal")
    ) {
      return false;
    }
    if (typeof result.imageUrl === "string") {
      const imageUrl = new URL(result.imageUrl);
      return imageUrl.protocol === "https:" &&
        !imageUrl.port &&
        !imageUrl.username &&
        !imageUrl.password &&
        imageUrl.hostname !== "localhost" &&
        !imageUrl.hostname.endsWith(".localhost") &&
        !imageUrl.hostname.endsWith(".local") &&
        !imageUrl.hostname.endsWith(".internal");
    }
    return true;
  } catch {
    return false;
  }
}

function ChatDockNodeView({ data }: NodeProps<CanvasNode>) {
  const [prompt, setPrompt] = useState("");

  if (!("onSubmit" in data)) {
    return null;
  }

  const submit = () => {
    const value = prompt.trim();
    if (!value || data.isLoading) return;
    void data.onSubmit(value, data.selectedContext);
    setPrompt("");
  };

  return (
    <form
      className="flex h-[132px] w-full flex-col justify-between rounded-2xl border border-[#343540] bg-[#191a22] p-3 shadow-[0_12px_40px_rgb(0_0_0_/_35%)]"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label className="text-[11px] font-medium text-[#aaa9b5]" htmlFor="canvas-prompt">
        {data.isLoading ? "Arc is thinking..." : "What would you like to create?"}
      </label>
      {data.selectedContext && (
        <div className="flex min-h-5 items-center gap-1.5 text-[9px] text-[#b5a1ff]">
          <span className="max-w-[90%] truncate rounded bg-[#2a2440] px-1.5 py-0.5">
            Asking about: {data.selectedContext.label}
          </span>
          <button
            aria-label="Clear selected node context"
            className="nodrag shrink-0 rounded px-1 text-[#aaa9b5] hover:bg-[#252630] hover:text-white"
            onClick={data.onClearContext}
            type="button"
          >
            ×
          </button>
        </div>
      )}
      <textarea
        id="canvas-prompt"
        aria-label="Describe what you want to create"
        className="nodrag nopan h-8 w-full resize-none border-0 bg-transparent p-0 text-sm leading-5 text-[#f0eff5] outline-none placeholder:text-[#777683]"
        onChange={(event) => setPrompt(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            submit();
          }
        }}
        placeholder="Describe an idea, workflow, or process..."
        disabled={data.isLoading}
        value={prompt}
      />
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-[#747380]">
          {data.isLoading ? "Generating a response..." : "Enter to send · Shift+Enter for a new line"}
        </span>
        <button
          aria-label="Send message"
          className="nodrag grid h-8 w-8 place-items-center rounded-lg bg-[#765bd8] text-base text-white transition-colors hover:bg-[#876de7] disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!prompt.trim() || data.isLoading}
          type="submit"
        >
          {data.isLoading ? "…" : "↑"}
        </button>
      </div>
    </form>
  );
}

function ResponseNodeView({ data }: NodeProps<CanvasNode>) {
  if (!("prompt" in data)) {
    return null;
  }

  return (
    <article className="flex h-full w-full flex-col gap-2 rounded-2xl border border-[#30313b] bg-[#181920] p-3 shadow-[0_8px_30px_rgb(0_0_0_/_25%)]">
      <Handle
        className="!top-[-5px] !h-[9px] !w-[9px] !border-2 !border-[#181920] !bg-[#a18de9]"
        id="workflow-input"
        position={Position.Top}
        type="target"
      />
      <div className="flex items-center gap-2">
        <span className="grid h-6 w-6 place-items-center rounded-lg bg-[#2a2440] text-xs text-[#b5a1ff]">a</span>
        <span className="text-[11px] font-semibold text-[#dfdee7]">Arc</span>
        {data.status === "loading" && <span className="text-[10px] text-[#777683]">Thinking…</span>}
      </div>
      <div className={`min-h-0 flex-1 ${data.isExpanded ? "overflow-y-auto" : "overflow-hidden"}`}>
        <p
          className={`m-0 whitespace-pre-wrap text-[11px] leading-4 ${
            data.isExpanded ? "" : "line-clamp-4"
          } ${
            data.status === "error" ? "text-[#f19a9a]" : "text-[#bcbac7]"
          }`}
          title={data.response}
        >
          {data.status === "loading" ? "Generating a response..." : data.response}
        </p>
        {data.generationTimeMs !== undefined && (
          <p className="mt-1 mb-0 text-[9px] text-[#747380]">
            Full response in {(data.generationTimeMs / 1000).toFixed(1)}s
          </p>
        )}
        {data.imageError && (
          <p className="mt-1 mb-0 line-clamp-1 text-[9px] text-[#d7b870]">{data.imageError}</p>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-[#2b2c35] pt-1">
        <button
          className="nodrag nopan rounded px-1.5 py-1 text-[9px] text-[#aaa9b5] transition-colors hover:bg-[#252630] hover:text-white"
          onClick={(event) => {
            event.stopPropagation();
            data.onShowHistory();
          }}
          type="button"
        >
          Chat history ({data.historyCount})
        </button>
        <button
          aria-expanded={data.isExpanded}
          className="nodrag nopan rounded px-2 py-1 text-[9px] font-medium text-[#b5a1ff] transition-colors hover:bg-[#2a2440]"
          onClick={(event) => {
            event.stopPropagation();
            data.onToggleExpand();
          }}
          type="button"
        >
          {data.isExpanded ? "Less" : "More"}
        </button>
      </div>
      <PositionHandle />
    </article>
  );
}

function ProcessNodeView({ data }: NodeProps<CanvasNode>) {
  if (!("logs" in data)) return null;

  const statusStyle = data.status === "active"
    ? "border-[#765bd8] bg-[#221c35] text-[#c5b7ff]"
    : data.status === "done"
      ? "border-[#365b49] bg-[#19251f] text-[#9bd4b0]"
      : "border-[#704343] bg-[#2a1b1b] text-[#f19a9a]";

  return (
    <div className={`flex h-full w-full items-center gap-2 rounded-xl border bg-[#181920] px-3 shadow-[0_8px_24px_rgb(0_0_0_/_20%)] ${statusStyle}`}>
      <Handle
        className="!top-[-5px] !h-[9px] !w-[9px] !border-2 !border-[#181920] !bg-[#a18de9]"
        id="process-input"
        position={Position.Top}
        type="target"
      />
      <Handle
        className="!bottom-[-5px] !top-auto !h-[9px] !w-[9px] !border-2 !border-[#181920] !bg-[#a18de9]"
        id="process-output"
        position={Position.Bottom}
        type="source"
      />
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/20 text-[10px]">
        {data.status === "done" ? "✓" : data.status === "active" ? "…" : "!"}
      </span>
      <span className="min-w-0 flex-1 truncate text-[10px] font-medium">{data.label}</span>
      <button
        className="nodrag nopan shrink-0 rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[9px] font-medium text-[#d6caff] hover:bg-white/10"
        onClick={(event) => {
          event.stopPropagation();
          data.onShowLogs();
        }}
        type="button"
      >
        View logs · {data.logs.length}
      </button>
    </div>
  );
}

function ComparisonNodeView({ data }: NodeProps<CanvasNode>) {
  if (!("products" in data)) return null;
  return (
    <article className="relative flex h-full w-full flex-col gap-2 overflow-hidden rounded-xl border border-[#423864] bg-[#1b1924] p-3 shadow-[0_8px_24px_rgb(0_0_0_/_20%)]">
      <Handle
        className="!top-[-5px] !h-[9px] !w-[9px] !border-2 !border-[#1b1924] !bg-[#a18de9]"
        id="comparison-input"
        position={Position.Top}
        type="target"
      />
      <Handle
        className="!bottom-[-5px] !top-auto !h-[9px] !w-[9px] !border-2 !border-[#1b1924] !bg-[#a18de9]"
        id="comparison-output"
        position={Position.Bottom}
        type="source"
      />
      <h3 className="m-0 text-[11px] font-semibold text-[#d6caff]">Product comparison</h3>
      <div className="grid min-h-0 flex-1 grid-cols-2 gap-2 overflow-hidden">
        {data.products.map(({ nodeId, scrapedResult }) => (
           <div className="flex min-w-0 gap-2 rounded-lg border border-white/5 bg-black/15 p-2" key={nodeId}>
             {scrapedResult.imageUrl && (
               <Image
                 alt=""
                 className="h-12 w-12 shrink-0 rounded-md bg-black/20 object-contain"
                 height={48}
                 src={scrapedResult.imageUrl}
                 unoptimized
                 width={48}
               />
             )}
             <div className="min-w-0">
               <p className="m-0 truncate text-[8px] uppercase tracking-wide text-[#9695a3]">
                 {scrapedResult.siteName}
               </p>
               <p className="m-0 truncate text-[9px] font-semibold text-[#e9e6f1]" title={scrapedResult.title}>
                 {scrapedResult.title}
               </p>
               <p className="mt-1 mb-0 truncate text-[10px] font-bold text-[#c5b7ff]">
                 {scrapedResult.price ?? "Price not found"}
               </p>
               <p className="mt-1 mb-0 line-clamp-3 text-[8px] leading-3 text-[#9695a3]">
                 {scrapedResult.description}
               </p>
             </div>
           </div>
        ))}
      </div>
    </article>
  );
}

function ChatHistoryDialog({
  messages,
  onClose,
}: {
  messages: ChatMessage[];
  onClose: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-labelledby="chat-history-title"
        aria-modal="true"
        className="flex max-h-[min(80vh,680px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#343540] bg-[#15161d] shadow-2xl"
        role="dialog"
      >
        <header className="flex items-center justify-between border-b border-[#292a33] px-5 py-4">
          <div>
            <h2 className="m-0 text-sm font-semibold text-[#f0eff5]" id="chat-history-title">
              Conversation
            </h2>
            <p className="mt-1 mb-0 text-[10px] text-[#858492]">
              {messages.length} messages · Remembered while this page is open
            </p>
          </div>
          <button
            aria-label="Close conversation"
            className="grid h-8 w-8 place-items-center rounded-lg text-lg text-[#aaa9b5] hover:bg-[#252630] hover:text-white"
            onClick={onClose}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="min-h-0 space-y-3 overflow-y-auto p-5">
          {messages.length === 0 ? (
            <p className="m-0 text-xs text-[#9695a3]">No completed messages yet.</p>
          ) : (
            messages.map((message, index) => (
              <article
                className={`max-w-[90%] rounded-xl border px-3 py-2.5 ${
                  message.role === "user"
                    ? "ml-auto border-[#4b3e79] bg-[#272137]"
                    : "border-[#30313b] bg-[#1c1d25]"
                }`}
                key={`${message.role}-${index}`}
              >
                <p className="mb-1 text-[9px] font-semibold uppercase tracking-wide text-[#aaa9b5]">
                  {message.role === "user" ? "You" : "Arc"}
                </p>
                <p className="m-0 whitespace-pre-wrap break-words text-xs leading-5 text-[#d7d6df]">
                  {message.content}
                </p>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}

function PositionHandle() {
  return (
    <Handle
      className="!bottom-[-5px] !left-1/2 !top-auto !h-[9px] !w-[9px] !-translate-x-1/2 !border-2 !border-[#181920] !bg-[#a18de9]"
      id="response-images"
      position={Position.Bottom}
      type="source"
    />
  );
}

function ImageNodeView({ data }: NodeProps<CanvasNode>) {
  if (!("image" in data)) return null;
  const { image } = data;

  return (
    <article className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-[#30313b] bg-[#181920] shadow-[0_8px_30px_rgb(0_0_0_/_25%)]">
      <Handle
        className="!top-[-5px] !h-[9px] !w-[9px] !border-2 !border-[#181920] !bg-[#a18de9]"
        id="image-source"
        position={Position.Top}
        type="target"
      />
      <a
        aria-label={`View ${image.title} on Wikimedia Commons`}
        className="relative h-[104px] w-full overflow-hidden bg-[#101116]"
        href={image.sourceUrl}
        rel="noreferrer"
        target="_blank"
      >
        <Image
          alt={image.title}
          className="h-full w-full object-cover"
          height={image.height}
          loading="lazy"
          src={image.thumbnailUrl}
          unoptimized
          width={image.width}
        />
      </a>
      <div className="min-h-0 flex-1 px-2.5 py-2">
        <p className="m-0 overflow-hidden text-ellipsis whitespace-nowrap text-[10px] font-medium text-[#dfdee7]" title={image.title}>
          {image.title}
        </p>
        <p className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap text-[9px] text-[#9695a3]" title={image.artist}>
          {image.artist} · {image.license}
        </p>
      </div>
    </article>
  );
}

const navigation = [
  { label: "Canvas", icon: "▦" },
  { label: "Components", icon: "◈" },
  { label: "Templates", icon: "▤" },
];

export default function Home() {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const nodeTypes = useMemo(
    () => ({
      chatDock: ChatDockNodeView,
      response: ResponseNodeView,
      image: ImageNodeView,
      scrapedResult: ScrapedResultNodeView,
      process: ProcessNodeView,
      comparison: ComparisonNodeView,
    }),
    [],
  );
  const [activeSection, setActiveSection] = useState("Canvas");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [processLogs, setProcessLogs] = useState<Pick<ProcessData, "label" | "status" | "logs">>();
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasSize = useRef({ width: 0, height: 0 });
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  const requestNumberRef = useRef(0);
  const scrapedResultsRef = useRef<{ nodeId: string; scrapedResult: ScrapedWebsiteResult }[]>([]);

  const showHistory = useCallback(() => setIsHistoryOpen(true), []);
  const updateSelectedNodeContext = useCallback((context?: SelectedNodeContext) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) =>
        node.id === "chat-dock" && "onSubmit" in node.data
          ? { ...node, data: { ...node.data, selectedContext: context } }
          : node,
      ),
    );
  }, [setNodes]);

  const toggleResponseExpanded = useCallback((responseId: string) => {
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (node.id !== responseId || !("prompt" in node.data)) return node;
        const isExpanded = !node.data.isExpanded;
        return {
          ...node,
          style: {
            ...node.style,
            height: isExpanded ? RESPONSE_EXPANDED_HEIGHT : RESPONSE_HEIGHT,
          },
          data: { ...node.data, isExpanded },
        };
      }),
    );
  }, [setNodes]);

  const handleSubmit = useCallback(async (prompt: string, context?: SelectedNodeContext) => {
    const { width, height } = canvasSize.current;
    const dockPosition = getDockPosition(width, height);
    const requestNumber = requestNumberRef.current++;
    const requestId = `request-${requestNumber + 1}`;
    const processId = `${requestId}-process`;
    const responseId = `${requestId}-response`;
    const resultId = `${requestId}-scraped-result`;
    const comparisonId = `${requestId}-comparison`;
    const laneY = 40;
    const centerX = Math.max(32, (width - 500) / 2);
    const priorScrapedResults = scrapedResultsRef.current.slice(-10);
    const historyCount = chatHistoryRef.current.length;
    const response: CanvasNode = {
      id: responseId,
      type: "response",
      position: { x: centerX + 30, y: laneY + PROCESS_HEIGHT + 30 },
      style: { width: Math.min(RESPONSE_WIDTH, width - 32), height: RESPONSE_HEIGHT },
      data: {
        onToggleExpand: () => toggleResponseExpanded(responseId),
        onShowHistory: showHistory,
        prompt,
        response: "",
        status: "loading",
        images: [],
        isExpanded: false,
        historyCount,
      },
    };
    const processNode: CanvasNode = {
      id: processId,
      type: "process",
      position: { x: centerX, y: laneY },
      style: { width: 420, height: PROCESS_HEIGHT },
      data: {
        label: "Working on your request",
        status: "active",
        logs: ["Request received", "Preparing the assistant workflow"],
        onShowLogs: () => setProcessLogs({
          label: "Working on your request",
          status: "active",
          logs: ["Request received", "Preparing the assistant workflow"],
        }),
      },
    };
    setNodes((currentNodes) => [
      ...currentNodes.map((node) =>
        node.id === "chat-dock"
          ? {
              ...node,
              position: dockPosition,
              style: { width: getDockWidth(width), height: DOCK_HEIGHT },
              data: { ...node.data, isLoading: true },
            }
          : { ...node, position: { ...node.position, y: node.position.y - 720 } },
      ),
      processNode,
      response,
    ]);
    try {
      const apiResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          history: chatHistoryRef.current.slice(-20),
          selectedNode: context,
          previousScrapedResults: priorScrapedResults,
        }),
      });
      if (!apiResponse.ok) {
        const errorResult: unknown = await apiResponse.json();
        throw new Error(
          typeof errorResult === "object" &&
          errorResult !== null &&
          "error" in errorResult &&
          typeof errorResult.error === "string"
            ? errorResult.error
            : "The assistant could not complete that request. Please try again.",
        );
      }
      if (!apiResponse.body) {
        throw new Error("The assistant returned an empty response. Please try again.");
      }

      let result: unknown;
      const reader = apiResponse.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const appendProcessLog = (message: string, label?: string) => {
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (node.id !== processId || !isProcessData(node.data)) return node;
            const processData = node.data;
            const nextLogs = [...processData.logs, message];
            return {
              ...node,
              data: {
                ...processData,
                label: label ?? processData.label,
                logs: nextLogs,
                onShowLogs: () => setProcessLogs({
                  label: label ?? processData.label,
                  status: processData.status,
                  logs: nextLogs,
                }),
              },
            };
          }),
        );
      };
      const processEvent = (line: string) => {
        if (!line.trim()) return;
        const eventValue: unknown = JSON.parse(line);
        if (typeof eventValue !== "object" || eventValue === null || !("type" in eventValue)) {
          throw new Error("The assistant returned an invalid progress event.");
        }
        if (
          eventValue.type === "plan" &&
          "steps" in eventValue &&
          Array.isArray(eventValue.steps) &&
          eventValue.steps.every((step): step is string => typeof step === "string")
        ) {
          appendProcessLog(`Plan: ${eventValue.steps.join(" → ")}`);
          return;
        }
        if (
          eventValue.type === "progress" &&
          "step" in eventValue &&
          typeof eventValue.step === "string" &&
          "message" in eventValue &&
          typeof eventValue.message === "string"
        ) {
          appendProcessLog(eventValue.message, eventValue.message);
          return;
        }
        if (eventValue.type === "done" && "result" in eventValue) {
          result = eventValue.result;
          setNodes((currentNodes) =>
            currentNodes.map((node) => {
              if (node.id !== processId || !isProcessData(node.data)) return node;
              const logs = [...node.data.logs, "Process complete"];
              return {
                ...node,
                data: {
                  ...node.data,
                  label: "Process complete",
                  status: "done" as const,
                  logs,
                  onShowLogs: () => setProcessLogs({
                    label: "Process complete",
                    status: "done",
                    logs,
                  }),
                },
              };
            }),
          );
          return;
        }
        if (eventValue.type === "error" && "error" in eventValue && typeof eventValue.error === "string") {
          throw new Error(eventValue.error);
        }
        throw new Error("The assistant returned an invalid progress event.");
      };

      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processEvent(line);
        if (done) break;
      }
      if (buffer.trim()) processEvent(buffer);
      if (result === undefined) {
        throw new Error("The assistant ended without returning a response.");
      }

      if (
        typeof result !== "object" ||
        result === null ||
        !("text" in result) ||
        typeof result.text !== "string"
      ) {
        const errorMessage =
          typeof result === "object" &&
          result !== null &&
          "error" in result &&
          typeof result.error === "string"
            ? result.error
            : "The assistant returned an invalid response.";
        throw new Error(errorMessage);
      }

      if (!apiResponse.ok) {
        throw new Error("The assistant could not complete that request. Please try again.");
      }

      const generatedText = result.text;
      const generationTimeMs =
        "generationTimeMs" in result &&
        typeof result.generationTimeMs === "number" &&
        Number.isFinite(result.generationTimeMs) &&
        result.generationTimeMs >= 0
          ? result.generationTimeMs
          : undefined;
      const images =
        "images" in result && Array.isArray(result.images)
          ? result.images.filter(isImageAsset)
          : [];
      const imageError =
        "imageError" in result && typeof result.imageError === "string"
          ? result.imageError
          : undefined;
      let scrapedResult: ScrapedWebsiteResult | undefined;
      if ("scrapedResult" in result && result.scrapedResult !== undefined) {
        if (!isScrapedWebsiteResult(result.scrapedResult)) {
          throw new Error("The assistant returned invalid scraped website details.");
        }
        scrapedResult = result.scrapedResult;
      }
      const currentScrapedNodeId = scrapedResult ? resultId : undefined;
      const comparisonProducts = isComparisonRequest(prompt)
        ? scrapedResult
          ? [
              ...priorScrapedResults.slice(-1),
              { nodeId: resultId, scrapedResult },
            ]
          : priorScrapedResults.slice(-2)
        : [];
      const hasComparison = comparisonProducts.length >= 2;
      const responseHistory: ChatMessage[] = [
        ...chatHistoryRef.current,
        { role: "user", content: prompt },
        { role: "assistant", content: generatedText },
      ];
      chatHistoryRef.current = responseHistory;
      setChatHistory(responseHistory);
      if (scrapedResult && currentScrapedNodeId) {
        scrapedResultsRef.current = [
          ...scrapedResultsRef.current,
          { nodeId: currentScrapedNodeId, scrapedResult },
        ].slice(-10);
      }
      const resultPosition = { x: centerX + 72, y: laneY + 108 };
      const comparisonPosition = {
        x: centerX - 20,
        y: laneY + (scrapedResult ? 400 : 110),
      };
      const responsePosition = {
        x: centerX + 30,
        y: laneY + (hasComparison ? (scrapedResult ? 610 : 320) : scrapedResult ? 410 : 108),
      };
      const responseImagesY = responsePosition.y + RESPONSE_HEIGHT + 24;
      const imageNodes: CanvasNode[] = images.map((image, index) => ({
        id: `${requestId}-image-${index + 1}`,
        type: "image",
        position: {
          x: centerX + index * (IMAGE_WIDTH + IMAGE_GAP),
          y: responseImagesY,
        },
        style: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
        data: { image },
      }));
      const newNodes: CanvasNode[] = [
        ...(scrapedResult
          ? [{
              id: resultId,
              type: "scrapedResult",
              position: resultPosition,
              style: { width: RESULT_WIDTH, height: RESULT_HEIGHT },
              data: { scrapedResult },
            } satisfies CanvasNode]
          : []),
        ...(hasComparison
          ? [{
              id: comparisonId,
              type: "comparison",
              position: comparisonPosition,
              style: { width: 460, height: COMPARISON_HEIGHT },
              data: { products: comparisonProducts },
            } satisfies CanvasNode]
          : []),
        ...imageNodes,
      ];
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id === responseId && "prompt" in node.data) {
            return {
              ...node,
              position: responsePosition,
              data: {
                ...node.data,
                response: generatedText,
                status: "success" as const,
                generationTimeMs,
                historyCount: responseHistory.length,
                images,
                imageError,
              },
            };
          }
          if (node.id === processId && isProcessData(node.data)) {
            return {
              ...node,
              data: {
                ...node.data,
                status: "done" as const,
                label: "Process complete",
              },
            };
          }
          if (node.id === "chat-dock" && "onSubmit" in node.data) {
            return { ...node, data: { ...node.data, isLoading: false } };
          }
          return node;
        }).concat(newNodes),
      );
      const addEdge = (id: string, source: string, target: string, sourceHandle?: string, targetHandle?: string): Edge => ({
        id,
        source,
        target,
        sourceHandle,
        targetHandle,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#8069d6", strokeWidth: 1.5 },
      });
      const requestEdges: Edge[] = [];
      if (scrapedResult) {
        requestEdges.push(addEdge(`${requestId}-process-result`, processId, resultId, "process-output", "scraped-result-input"));
      }
      if (hasComparison) {
        comparisonProducts.forEach(({ nodeId }) => {
          requestEdges.push(addEdge(
            `${requestId}-${nodeId}-comparison`,
            nodeId,
            comparisonId,
            "scraped-result-output",
            "comparison-input",
          ));
        });
        if (!scrapedResult) {
          requestEdges.push(addEdge(`${requestId}-process-comparison`, processId, comparisonId, "process-output", "comparison-input"));
        }
        requestEdges.push(addEdge(`${requestId}-comparison-response`, comparisonId, responseId, "comparison-output", "workflow-input"));
      } else if (scrapedResult) {
        requestEdges.push(addEdge(
          `${requestId}-result-response`,
          resultId,
          responseId,
          "scraped-result-output",
          "workflow-input",
        ));
      } else {
        requestEdges.push(addEdge(`${requestId}-process-response`, processId, responseId, "process-output", "workflow-input"));
      }
      images.forEach((_, index) =>
        requestEdges.push(addEdge(
          `${requestId}-response-image-${index + 1}`,
          responseId,
          `${requestId}-image-${index + 1}`,
          "response-images",
          "image-source",
        )),
      );
      setEdges((currentEdges) => [...currentEdges, ...requestEdges]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reach the assistant. Please try again.";
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
            if (node.id === responseId && "prompt" in node.data) {
              return {
                ...node,
                data: { ...node.data, response: message, status: "error" as const, images: [] },
              };
            }
            if (node.id === processId && isProcessData(node.data)) {
              const logs = [...node.data.logs, `Error: ${message}`];
              return {
                ...node,
                data: {
                  ...node.data,
                  label: "Process failed",
                  status: "error" as const,
                  logs,
                  onShowLogs: () => setProcessLogs({
                    label: "Process failed",
                    status: "error",
                    logs,
                  }),
                },
              };
            }
            if (node.id === "chat-dock" && "onSubmit" in node.data) {
              return {
                ...node,
                data: { ...node.data, isLoading: false },
              };
            }
            return node;
          }),
      );
    }
  }, [setEdges, setNodes, showHistory, toggleResponseExpanded]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (!width || !height) return;
      canvasSize.current = { width, height };

      setNodes((currentNodes) => {
        const dockPosition = getDockPosition(width, height);
        const dockWidth = getDockWidth(width);
        if (currentNodes.length === 0) {
          return [{
            id: "chat-dock",
            type: "chatDock",
            position: dockPosition,
            style: { width: dockWidth, height: DOCK_HEIGHT },
            draggable: false,
            deletable: false,
            data: {
              isLoading: false,
              onSubmit: handleSubmit,
              onClearContext: () => updateSelectedNodeContext(undefined),
            },
            selectable: false,
            connectable: false,
          }];
        }

        return currentNodes.map((node) =>
          node.id === "chat-dock"
            ? {
                ...node,
                position: dockPosition,
                style: { width: dockWidth, height: DOCK_HEIGHT },
              }
            : node,
        );
      });
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [handleSubmit, setNodes, updateSelectedNodeContext]);

  return (
    <main className="flex h-screen min-h-[430px] w-full overflow-hidden bg-[#101116] font-sans text-[#e9e8ef]">
      <aside className="relative z-10 flex min-h-screen w-[15%] min-w-[190px] max-w-[230px] shrink-0 flex-col border-r border-[#262731] bg-[#14151b] px-[18px] pt-[27px] pb-4 max-md:w-[68px] max-md:min-w-[68px] max-md:items-center max-md:px-2 max-md:pt-5 max-md:pb-3 max-[450px]:w-14 max-[450px]:min-w-14 max-[450px]:px-[5px]">
        <a
          className="mb-[31px] ml-1 flex w-fit items-center no-underline max-md:mx-0 max-md:mb-[26px]"
          href="#"
          aria-label="Arc home"
        >
          <Image
            alt="Arc"
            className="h-[28px] w-[118px] object-contain object-left max-md:h-[22px] max-md:w-[52px]"
            height={294}
            priority
            src="/ARC.png"
            width={1244}
          />
        </a>

        <div className="flex items-center gap-2.5 rounded-[10px] border border-[#2a2b35] bg-[#191a21] px-2.5 py-[11px] max-md:border-0 max-md:p-[7px]">
          <div className="grid h-[31px] w-[31px] shrink-0 place-items-center rounded-lg bg-[#2d2745] text-[13px] font-bold text-[#b6a5ff]">S</div>
          <div className="flex min-w-0 flex-1 flex-col gap-[3px] max-md:hidden">
            <strong className="overflow-hidden text-ellipsis whitespace-nowrap text-[11px] font-semibold">Studio workspace</strong>
            <span className="text-[10px] text-[#92919e]">Free plan</span>
          </div>
          <span className="text-[17px] text-[#a09fab] max-md:hidden">⌄</span>
        </div>

        <div className="mt-[30px] mb-[9px] ml-[9px] text-[9px] font-bold tracking-[1px] text-[#858492] max-md:hidden">WORKSPACE</div>
        <nav className="grid gap-[3px]" aria-label="Workspace navigation">
          {navigation.map((item) => (
            <button
              className={`flex min-h-[39px] w-full items-center gap-[11px] rounded-lg px-2.5 text-left text-xs transition-colors hover:bg-[#1d1e26] max-md:w-[42px] max-md:justify-center max-md:px-0 ${
                activeSection === item.label
                  ? "bg-[#28223a] font-semibold text-[#c0b2ff] hover:bg-[#28223a]"
                  : "bg-transparent text-[#aaa9b5]"
              }`}
              key={item.label}
              onClick={() => setActiveSection(item.label)}
              type="button"
            >
              <span className={`w-[17px] text-center text-base max-md:text-lg ${activeSection === item.label ? "text-[#b5a4ff]" : "text-[#9695a3]"}`} aria-hidden="true">{item.icon}</span>
              <span className="max-md:hidden">{item.label}</span>
              {item.label === "Components" && <span className="ml-auto text-[10px] text-[#9695a3] max-md:hidden">8</span>}
            </button>
          ))}
        </nav>

        <div className="mt-[29px] mb-[9px] ml-[9px] text-[9px] font-bold tracking-[1px] text-[#858492] max-md:hidden">RECENT CANVASES</div>
        <button className="flex min-h-[35px] w-full items-center gap-2.5 rounded-[7px] bg-transparent px-2.5 text-left text-[11px] font-semibold text-[#e0dfe8] hover:bg-[#1d1e26] max-md:hidden" type="button">
          <span className="h-[7px] w-[7px] rounded-full bg-[#8469e4]" />
          Lead qualification flow
        </button>
        <button className="flex min-h-[35px] w-full items-center gap-2.5 rounded-[7px] bg-transparent px-2.5 text-left text-[11px] text-[#a5a4b0] hover:bg-[#1d1e26] max-md:hidden" type="button">
          <span className="h-[7px] w-[7px] rounded-full bg-[#545360]" />
          Welcome email sequence
        </button>
        <button className="flex min-h-[35px] w-full items-center gap-2.5 rounded-[7px] bg-transparent px-2.5 text-left text-[11px] text-[#a5a4b0] hover:bg-[#1d1e26] max-md:hidden" type="button">
          <span className="h-[7px] w-[7px] rounded-full bg-[#545360]" />
          Support handoff
        </button>

        <div className="mt-auto grid w-full gap-[13px] max-md:justify-items-center">
          <button className="flex w-full items-center gap-2.5 rounded-[7px] bg-transparent px-[9px] py-2.5 text-left text-[11px] text-[#a5a4b0] hover:bg-[#1d1e26] max-md:hidden" type="button">
            <span className="grid h-4 w-4 place-items-center rounded-full border border-[#656471] text-[10px] text-[#b1b0bc]">?</span> Help center
          </button>
          <button className="flex w-full items-center gap-2.5 border-t border-[#292a33] bg-transparent px-[7px] pt-3 text-left hover:bg-[#1d1e26] max-md:justify-center max-md:px-0" type="button">
            <span className="grid h-[31px] w-[31px] shrink-0 place-items-center rounded-full bg-[#382a25] text-xs font-bold text-[#e3b596]">R</span>
            <span className="flex min-w-0 flex-1 flex-col gap-[3px] max-md:hidden"><strong className="text-[11px] font-semibold text-[#e7e6ed]">Rishu</strong><small className="text-[10px] text-[#92919e]">Personal account</small></span>
            <span className="text-[17px] text-[#a09fab] max-md:hidden">···</span>
          </button>
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col" aria-label="Workflow canvas">
        <div
          ref={canvasRef}
          className="relative min-h-0 flex-1 overflow-hidden bg-[#09090b] [--xy-attribution-background-color:rgb(9_9_11_/_95%)]"
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={(_, node) => {
              const context = getNodeContext(node);
              if (context) updateSelectedNodeContext(context);
            }}
            onPaneClick={() => updateSelectedNodeContext(undefined)}
            nodesConnectable={false}
            minZoom={0.25}
            maxZoom={1.5}
            defaultEdgeOptions={{ type: "smoothstep" }}
          >
          </ReactFlow>
        </div>
      </section>
      {isHistoryOpen && (
        <ChatHistoryDialog
          messages={chatHistory}
          onClose={() => setIsHistoryOpen(false)}
        />
      )}
      {processLogs && (
        <div
          className="fixed inset-0 z-[100] grid place-items-center bg-black/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setProcessLogs(undefined);
          }}
        >
          <section
            aria-labelledby="process-logs-title"
            aria-modal="true"
            className="flex max-h-[min(80vh,680px)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[#343540] bg-[#15161d] shadow-2xl"
            role="dialog"
          >
            <header className="flex items-center justify-between border-b border-[#292a33] px-5 py-4">
              <div>
                <h2 className="m-0 text-sm font-semibold text-[#f0eff5]" id="process-logs-title">
                  Process logs
                </h2>
                <p className="mt-1 mb-0 text-[10px] text-[#858492]">
                  {processLogs.label} · {processLogs.status}
                </p>
              </div>
              <button
                aria-label="Close process logs"
                className="grid h-8 w-8 place-items-center rounded-lg text-lg text-[#aaa9b5] hover:bg-[#252630] hover:text-white"
                onClick={() => setProcessLogs(undefined)}
                type="button"
              >
                ×
              </button>
            </header>
            <ol className="m-0 min-h-0 list-decimal space-y-2 overflow-y-auto px-10 py-5 text-xs leading-5 text-[#c7c5d1]">
              {processLogs.logs.map((log, index) => (
                <li className="pl-1" key={`${index}-${log}`}>{log}</li>
              ))}
            </ol>
          </section>
        </div>
      )}
    </main>
  );
}
