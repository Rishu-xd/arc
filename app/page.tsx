"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
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
  nodeType: "response" | "image" | "workflowStep";
  label: string;
  details: string;
};

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type ResponseData = {
  prompt: string;
  response: string;
  status: "loading" | "success" | "error";
  generationTimeMs?: number;
  isExpanded: boolean;
  historyCount: number;
  onToggleExpand: () => void;
  onShowHistory: () => void;
  images: ImageAsset[];
  imageError?: string;
};

type WorkflowStepData = {
  label: string;
  status: "pending" | "active" | "done" | "error";
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
type CanvasNodeData = ChatDockData | ResponseData | ImageNodeData | WorkflowStepData;
type CanvasNode = Node<CanvasNodeData>;

const DOCK_HEIGHT = 132;
const RESPONSE_WIDTH = 360;
const RESPONSE_HEIGHT = 172;
const RESPONSE_EXPANDED_HEIGHT = 360;
const IMAGE_WIDTH = 220;
const IMAGE_HEIGHT = 132;
const IMAGE_GAP = 12;
const WORKFLOW_STEP_HEIGHT = 48;

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

function getDockPosition(width: number, height: number) {
  const dockWidth = getDockWidth(width);

  return {
    x: Math.max(16, (width - dockWidth) / 2),
    y: Math.max(16, height - DOCK_HEIGHT - 28),
  };
}

function getImageLayout(
  width: number,
  height: number,
  imageCount: number,
  responseHeight = RESPONSE_HEIGHT,
) {
  const dockPosition = getDockPosition(width, height);
  const columns = Math.max(1, Math.min(imageCount, width >= 960 ? 4 : width >= 760 ? 3 : 2));
  const imageWidth = Math.max(
    120,
    Math.min(IMAGE_WIDTH, (width - 32 - IMAGE_GAP * (columns - 1)) / columns),
  );
  const rows = Math.ceil(imageCount / columns);
  const gridWidth = columns * imageWidth + (columns - 1) * IMAGE_GAP;
  const gridHeight = rows * IMAGE_HEIGHT + (rows - 1) * IMAGE_GAP;
  const totalHeight = responseHeight + 16 + gridHeight;
  const responseTop = imageCount
    ? Math.max(12, (height - DOCK_HEIGHT - 28 - totalHeight) / 2)
    : Math.max(16, dockPosition.y - responseHeight - 24);
  const imageTop = responseTop + responseHeight + 16;

  return {
    response: {
      x: Math.max(16, (width - RESPONSE_WIDTH) / 2),
      y: responseTop,
    },
    imageWidth,
    images: Array.from({ length: imageCount }, (_, index) => ({
      x: Math.max(16, (width - gridWidth) / 2 + (index % columns) * (imageWidth + IMAGE_GAP)),
      y: imageTop + Math.floor(index / columns) * (IMAGE_HEIGHT + IMAGE_GAP),
    })),
  };
}

function getResponsePosition(width: number, height: number, responseHeight: number) {
  const responseWidth = Math.min(RESPONSE_WIDTH, width - 32);
  return {
    x: Math.max(16, (width - responseWidth) / 2),
    y: Math.max(16, (height - responseHeight) / 2),
  };
}

function getWorkflowStepPositions(width: number, height: number, responseHeight: number) {
  const gap = 10;
  const stepWidth = Math.max(140, width - 32);
  const responsePosition = getResponsePosition(width, height, responseHeight);
  const top = Math.max(
    12,
    responsePosition.y - 12 - 3 * WORKFLOW_STEP_HEIGHT - 2 * gap,
  );

  return Array.from({ length: 3 }, (_, index) => ({
    x: Math.max(16, (width - stepWidth) / 2),
    y: top + index * (WORKFLOW_STEP_HEIGHT + gap),
  }));
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

function WorkflowStepNodeView({ data }: NodeProps<CanvasNode>) {
  if (!("label" in data)) return null;

  const statusStyle = {
    pending: "border-[#343540] text-[#777683]",
    active: "border-[#765bd8] bg-[#221c35] text-[#c5b7ff]",
    done: "border-[#365b49] bg-[#19251f] text-[#9bd4b0]",
    error: "border-[#704343] bg-[#2a1b1b] text-[#f19a9a]",
  }[data.status];

  return (
    <div className={`flex h-full w-full items-center gap-2 rounded-xl border bg-[#181920] px-3 shadow-[0_8px_24px_rgb(0_0_0_/_20%)] ${statusStyle}`}>
      <Handle
        className="!top-[-5px] !h-[9px] !w-[9px] !border-2 !border-[#181920] !bg-[#a18de9]"
        id="workflow-input"
        position={Position.Top}
        type="target"
      />
      <Handle
        className="!bottom-[-5px] !top-auto !h-[9px] !w-[9px] !border-2 !border-[#181920] !bg-[#a18de9]"
        id="workflow-output"
        position={Position.Bottom}
        type="source"
      />
      <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-black/20 text-[10px]">
        {data.status === "done" ? "✓" : data.status === "active" ? "…" : data.status === "error" ? "!" : "·"}
      </span>
      <span className="truncate text-[10px] font-medium">{data.label}</span>
    </div>
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

const nodeTypes = {
  chatDock: ChatDockNodeView,
  response: ResponseNodeView,
  image: ImageNodeView,
  workflowStep: WorkflowStepNodeView,
};

const navigation = [
  { label: "Canvas", icon: "▦" },
  { label: "Components", icon: "◈" },
  { label: "Templates", icon: "▤" },
];

export default function Home() {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [activeSection, setActiveSection] = useState("Canvas");
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const canvasSize = useRef({ width: 0, height: 0 });
  const chatHistoryRef = useRef<ChatMessage[]>([]);

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

  const toggleResponseExpanded = useCallback(() => {
    const { width, height } = canvasSize.current;
    setNodes((currentNodes) => {
      const responseNode = currentNodes.find(
        (node): node is CanvasNode & { data: ResponseData } =>
          node.id === "assistant-response" && "prompt" in node.data,
      );
      if (!responseNode) return currentNodes;

      const isExpanded = !responseNode.data.isExpanded;
      const responseHeight = isExpanded ? RESPONSE_EXPANDED_HEIGHT : RESPONSE_HEIGHT;
      const imageNodes = currentNodes.filter(
        (node): node is CanvasNode & { data: ImageNodeData } =>
          node.type === "image" && "image" in node.data,
      );
      const layout = getImageLayout(width, height, imageNodes.length, responseHeight);
      const responsePosition = getResponsePosition(width, height, responseHeight);

      return currentNodes.map((node) => {
        if (node.id === "assistant-response") {
          return {
            ...node,
            position: responsePosition,
            style: { width: Math.min(RESPONSE_WIDTH, width - 32), height: responseHeight },
            data: { ...responseNode.data, isExpanded },
          };
        }
        if (node.type === "image") {
          const index = imageNodes.findIndex((imageNode) => imageNode.id === node.id);
          const position = layout.images[index];
          return position
            ? {
                ...node,
                position: {
                  ...position,
                  y: position.y + responsePosition.y - layout.response.y,
                },
              }
            : node;
        }
        return node;
      });
    });
  }, [setNodes]);

  const handleSubmit = useCallback(async (prompt: string, context?: SelectedNodeContext) => {
    const { width, height } = canvasSize.current;
    const dockPosition = getDockPosition(width, height);
    const responseWidth = Math.min(RESPONSE_WIDTH, width - 32);
    const historyCount = chatHistoryRef.current.length;
    const response: CanvasNode = {
      id: "assistant-response",
      type: "response",
      position: getResponsePosition(width, height, RESPONSE_HEIGHT),
      style: { width: responseWidth, height: RESPONSE_HEIGHT },
      data: {
        prompt,
        response: "",
        status: "loading",
        images: [],
        isExpanded: false,
        historyCount,
        onToggleExpand: toggleResponseExpanded,
        onShowHistory: showHistory,
      },
    };
    const workflowLabels = [
      "Search provided URL",
      "Extract readable HTML",
      "Analyze page and answer",
    ];
    let activeStepIndex = -1;
    let hasWorkflowSteps = false;

    setNodes((currentNodes) => [
      ...currentNodes
        .filter((node) => node.id === "chat-dock")
        .map((node) =>
          ({
            ...node,
            position: dockPosition,
            style: { width: getDockWidth(width), height: DOCK_HEIGHT },
            data: { ...node.data, isLoading: true },
          }),
        ),
      response,
    ]);
    setEdges([]);

    try {
      const apiResponse = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt,
          history: chatHistoryRef.current.slice(-20),
          selectedNode: context,
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
          eventValue.steps.length === 3 &&
          eventValue.steps.every((step): step is string => typeof step === "string")
        ) {
          workflowLabels.splice(0, workflowLabels.length, ...eventValue.steps);
          hasWorkflowSteps = true;
          return;
        }
        if (
          eventValue.type === "progress" &&
          "step" in eventValue &&
          typeof eventValue.step === "string" &&
          "message" in eventValue &&
          typeof eventValue.message === "string"
        ) {
          const stepIndex = eventValue.step === "open" ? 0 : eventValue.step === "extract" ? 1 : 2;
          const progressMessage = eventValue.message;
          activeStepIndex = stepIndex;
          if (hasWorkflowSteps) {
            const positions = getWorkflowStepPositions(width, height, RESPONSE_HEIGHT);
            setNodes((currentNodes) => {
              const existingIndexes = new Set(
                currentNodes
                  .filter((node) => node.type === "workflowStep")
                  .map((node) => Number(node.id.slice("workflow-step-".length)) - 1),
              );
              const updatedNodes = currentNodes.map((node) => {
                if (!node.id.startsWith("workflow-step-") || !("label" in node.data)) return node;
                const index = Number(node.id.slice("workflow-step-".length)) - 1;
                return {
                  ...node,
                  data: {
                    ...node.data,
                    label: index === stepIndex ? progressMessage : node.data.label,
                    status: index < stepIndex ? "done" as const : index === stepIndex ? "active" as const : "pending" as const,
                  },
                };
              });
              const addedNodes: CanvasNode[] = workflowLabels
                .slice(0, stepIndex + 1)
                .flatMap((label, index) =>
                  existingIndexes.has(index)
                    ? []
                    : [{
                        id: `workflow-step-${index + 1}`,
                        type: "workflowStep",
                        position: positions[index],
                        style: {
                          width: Math.max(140, width - 32),
                          height: WORKFLOW_STEP_HEIGHT,
                        },
                        draggable: true,
                        deletable: false,
                        selectable: true,
                        connectable: false,
                        data: {
                          label: index === stepIndex ? progressMessage : label,
                          status: index < stepIndex ? "done" : "active",
                        },
                      }],
                );
              return [...updatedNodes, ...addedNodes];
            });

            const edgeCount = Math.min(stepIndex + 1, workflowLabels.length);
            setEdges([
              ...Array.from({ length: Math.max(0, edgeCount - 1) }, (_, index) => ({
                id: `workflow-edge-${index + 1}`,
                source: `workflow-step-${index + 1}`,
                target: `workflow-step-${index + 2}`,
                sourceHandle: "workflow-output",
                targetHandle: "workflow-input",
                type: "smoothstep" as const,
                animated: true,
                style: { stroke: "#8069d6", strokeWidth: 1.5 },
              })),
              ...(edgeCount === workflowLabels.length ? [{
                id: "workflow-to-response",
                source: `workflow-step-${workflowLabels.length}`,
                target: "assistant-response",
                sourceHandle: "workflow-output",
                targetHandle: "workflow-input",
                type: "smoothstep" as const,
                animated: true,
                style: { stroke: "#8069d6", strokeWidth: 1.5 },
              }] : []),
            ]);
          }
          return;
        }
        if (eventValue.type === "done" && "result" in eventValue) {
          result = eventValue.result;
          activeStepIndex = hasWorkflowSteps ? workflowLabels.length - 1 : -1;
          setNodes((currentNodes) =>
            currentNodes.map((node) =>
              node.id.startsWith("workflow-step-") && "label" in node.data
                ? { ...node, data: { ...node.data, status: "done" as const } }
                : node,
            ),
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
      const responseHistory: ChatMessage[] = [
        ...chatHistoryRef.current,
        { role: "user", content: prompt },
        { role: "assistant", content: generatedText },
      ];
      chatHistoryRef.current = responseHistory;
      setChatHistory(responseHistory);
      const imageLayout = getImageLayout(width, height, images.length, RESPONSE_HEIGHT);
      const responsePosition = getResponsePosition(width, height, RESPONSE_HEIGHT);
      const imageNodes: CanvasNode[] = images.map((image, index) => ({
        id: `response-image-${index + 1}`,
        type: "image",
        position: {
          ...imageLayout.images[index],
          y: imageLayout.images[index].y + responsePosition.y - imageLayout.response.y,
        },
        style: { width: imageLayout.imageWidth, height: IMAGE_HEIGHT },
        data: { image },
      }));

      setNodes((currentNodes) =>
        currentNodes
          .filter((node) => node.type !== "image")
          .map((node) => {
            if (node.id === "assistant-response" && "prompt" in node.data) {
              return {
                ...node,
                position: responsePosition,
                style: { width: responseWidth, height: RESPONSE_HEIGHT },
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
            if (node.id === "chat-dock" && "onSubmit" in node.data) {
              return {
                ...node,
                data: { ...node.data, isLoading: false },
              };
            }
            return node;
          })
          .concat(imageNodes),
      );
      setEdges([
        ...(hasWorkflowSteps
          ? workflowLabels.slice(1).map((_, index) => ({
              id: `workflow-edge-${index + 1}`,
              source: `workflow-step-${index + 1}`,
              target: `workflow-step-${index + 2}`,
              sourceHandle: "workflow-output",
              targetHandle: "workflow-input",
              type: "smoothstep" as const,
              animated: false,
              style: { stroke: "#8069d6", strokeWidth: 1.5 },
            }))
          : []),
        ...(hasWorkflowSteps ? [{
          id: "workflow-to-response",
          source: `workflow-step-${workflowLabels.length}`,
          target: "assistant-response",
          sourceHandle: "workflow-output",
          targetHandle: "workflow-input",
          type: "smoothstep" as const,
          animated: false,
          style: { stroke: "#8069d6", strokeWidth: 1.5 },
        }] : []),
        ...images.map((_, index) => ({
        id: `response-to-image-${index + 1}`,
        source: "assistant-response",
        sourceHandle: "response-images",
        target: `response-image-${index + 1}`,
        targetHandle: "image-source",
        type: "smoothstep",
        style: { stroke: "#8069d6", strokeWidth: 1.5 },
        })),
      ]);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Could not reach the assistant. Please try again.";
      if (activeStepIndex >= 0) {
        setNodes((currentNodes) =>
          currentNodes.map((node) => {
            if (!node.id.startsWith("workflow-step-") || !("label" in node.data)) return node;
            const index = Number(node.id.slice("workflow-step-".length)) - 1;
            return index === activeStepIndex
              ? { ...node, data: { ...node.data, status: "error" as const } }
              : node;
          }),
        );
      }
      setNodes((currentNodes) =>
        currentNodes
          .filter((node) => node.type !== "image")
          .map((node) => {
            if (node.id === "assistant-response" && "prompt" in node.data) {
              return {
                ...node,
                data: { ...node.data, response: message, status: "error" as const, images: [] },
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
      setEdges((currentEdges) =>
        currentEdges.filter((edge) => edge.id.startsWith("workflow-")),
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
        const dockWidth = getDockWidth(width);
        const dockPosition = getDockPosition(width, height);
        const responseWidth = Math.min(RESPONSE_WIDTH, width - 32);
        const imageNodes = currentNodes.filter(
          (node): node is CanvasNode & { data: ImageNodeData } =>
            node.type === "image" && "image" in node.data,
        );
        const responseNode = currentNodes.find(
          (node): node is CanvasNode & { data: ResponseData } =>
            node.id === "assistant-response" && "prompt" in node.data,
        );
        const responseHeight = responseNode?.data.isExpanded
          ? RESPONSE_EXPANDED_HEIGHT
          : RESPONSE_HEIGHT;
        const layout = getImageLayout(width, height, imageNodes.length, responseHeight);
        const responsePosition = getResponsePosition(width, height, responseHeight);

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

        return currentNodes.map((node) => {
          if (node.id === "chat-dock") {
            return {
              ...node,
              position: dockPosition,
              style: { width: dockWidth, height: DOCK_HEIGHT },
            };
          }
          if (node.id === "assistant-response") {
            return {
              ...node,
              position: responsePosition,
              style: { width: responseWidth, height: responseHeight },
            };
          }
          if (node.type === "image") {
            const index = imageNodes.findIndex((imageNode) => imageNode.id === node.id);
            const position = layout.images[index];
            if (!position) return node;
            return {
              ...node,
              position: {
                ...position,
                y: position.y + responsePosition.y - layout.response.y,
              },
              style: { width: layout.imageWidth, height: IMAGE_HEIGHT },
            };
          }
          return node;
        });
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
    </main>
  );
}
