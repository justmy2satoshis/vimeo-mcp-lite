#!/usr/bin/env node
/**
 * vimeo-mcp-lite - Token-efficient MCP server for Vimeo API
 *
 * Design principles:
 * 1. Minimal response payloads (~100 chars/video vs ~18KB in other MCPs)
 * 2. First-class folder operations
 * 3. Server-side filtering to reduce data transfer
 * 4. Pagination with counts, not full data dumps
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import https from "https";

const ACCESS_TOKEN = process.env.VIMEO_ACCESS_TOKEN;

if (!ACCESS_TOKEN) {
  console.error("Error: VIMEO_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

// ============================================
// VIMEO API HELPER
// ============================================

interface VimeoResponse {
  status: number;
  data: any;
}

async function vimeoRequest(endpoint: string, method = "GET", body?: any): Promise<VimeoResponse> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: "api.vimeo.com",
      path: endpoint,
      method,
      headers: {
        "Authorization": `bearer ${ACCESS_TOKEN}`,
        "Accept": "application/vnd.vimeo.*+json;version=3.4",
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode || 0, data: data ? JSON.parse(data) : {} });
        } catch {
          resolve({ status: res.statusCode || 0, data: {} });
        }
      });
    });

    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ============================================
// MINIMAL DATA EXTRACTORS
// ============================================

interface VideoMinimal {
  id: string;
  name: string;
  duration: number;
  created: string;
  folder?: string;
}

interface FolderMinimal {
  id: string;
  name: string;
  video_count: number;
}

function extractVideoMinimal(video: any): VideoMinimal {
  const uri = video.uri || "";
  const id = uri.split("/").pop() || "";
  return {
    id,
    name: video.name || "Untitled",
    duration: video.duration || 0,
    created: video.created_time?.split("T")[0] || "",
    folder: video.parent_folder?.name,
  };
}

function extractFolderMinimal(folder: any): FolderMinimal {
  const uri = folder.uri || "";
  const id = uri.split("/").pop() || "";
  return {
    id,
    name: folder.name || "Untitled",
    video_count: folder.metadata?.connections?.videos?.total || 0,
  };
}

// ============================================
// TOOL DEFINITIONS
// ============================================

const TOOLS = [
  {
    name: "list_folders",
    description: "List all Vimeo folders with video counts. Returns: [{id, name, video_count}]",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "list_videos",
    description: "List videos with minimal data. Returns: [{id, name, duration, created, folder}]. Use page param for pagination.",
    inputSchema: {
      type: "object" as const,
      properties: {
        folder_id: { type: "string", description: "Filter by folder ID (optional)" },
        search: { type: "string", description: "Search by name (optional)" },
        page: { type: "number", description: "Page number (default: 1)" },
        per_page: { type: "number", description: "Results per page (default: 50, max: 100)" },
      },
    },
  },
  {
    name: "get_video",
    description: "Get details for a specific video. Returns: {id, name, description, duration, created, folder, tags, privacy, link}",
    inputSchema: {
      type: "object" as const,
      properties: {
        video_id: { type: "string", description: "Video ID" },
      },
      required: ["video_id"],
    },
  },
  {
    name: "get_folder_videos",
    description: "Get all videos in a folder. Returns: {folder, total, videos: [{id, name, duration, created}]}",
    inputSchema: {
      type: "object" as const,
      properties: {
        folder_id: { type: "string", description: "Folder ID" },
        page: { type: "number", description: "Page number (default: 1)" },
        per_page: { type: "number", description: "Results per page (default: 50, max: 100)" },
      },
      required: ["folder_id"],
    },
  },
  {
    name: "move_video",
    description: "Move a video to a folder. Returns: {success, video_id, folder_id}",
    inputSchema: {
      type: "object" as const,
      properties: {
        video_id: { type: "string", description: "Video ID to move" },
        folder_id: { type: "string", description: "Target folder ID" },
      },
      required: ["video_id", "folder_id"],
    },
  },
  {
    name: "create_folder",
    description: "Create a new folder. Returns: {id, name}",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Folder name" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_video",
    description: "Update video metadata. Returns: {success, video_id}",
    inputSchema: {
      type: "object" as const,
      properties: {
        video_id: { type: "string", description: "Video ID" },
        name: { type: "string", description: "New title (optional)" },
        description: { type: "string", description: "New description (optional)" },
        tags: { type: "array", items: { type: "string" }, description: "Tags array (optional)" },
      },
      required: ["video_id"],
    },
  },
  {
    name: "search_videos",
    description: "Search videos by name. Returns: {total, page, videos: [{id, name, duration, created, folder}]}",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Search query" },
        page: { type: "number", description: "Page number (default: 1)" },
        per_page: { type: "number", description: "Results per page (default: 25, max: 100)" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_stats",
    description: "Get account statistics. Returns: {total_videos, total_folders, storage_used}",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ============================================
// TOOL HANDLERS
// ============================================

async function handleListFolders(): Promise<string> {
  const folders: FolderMinimal[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await vimeoRequest(`/me/projects?per_page=100&page=${page}`);
    if (res.status === 200 && res.data.data) {
      folders.push(...res.data.data.map(extractFolderMinimal));
      hasMore = res.data.data.length === 100;
      page++;
    } else {
      hasMore = false;
    }
  }

  return JSON.stringify({ total: folders.length, folders }, null, 2);
}

async function handleListVideos(args: any): Promise<string> {
  const page = args.page || 1;
  const perPage = Math.min(args.per_page || 50, 100);

  let endpoint = `/me/videos?per_page=${perPage}&page=${page}&fields=uri,name,duration,created_time,parent_folder`;

  if (args.folder_id) {
    endpoint = `/me/projects/${args.folder_id}/videos?per_page=${perPage}&page=${page}&fields=uri,name,duration,created_time`;
  }

  if (args.search) {
    endpoint += `&query=${encodeURIComponent(args.search)}`;
  }

  const res = await vimeoRequest(endpoint);

  if (res.status !== 200) {
    return JSON.stringify({ error: "Failed to fetch videos", status: res.status });
  }

  const videos = res.data.data?.map(extractVideoMinimal) || [];
  const total = res.data.total || videos.length;

  return JSON.stringify({ total, page, per_page: perPage, videos }, null, 2);
}

async function handleGetVideo(args: any): Promise<string> {
  const res = await vimeoRequest(`/videos/${args.video_id}?fields=uri,name,description,duration,created_time,parent_folder,tags,privacy,link`);

  if (res.status !== 200) {
    return JSON.stringify({ error: "Video not found", status: res.status });
  }

  const v = res.data;
  return JSON.stringify({
    id: args.video_id,
    name: v.name,
    description: v.description?.substring(0, 500) || "",
    duration: v.duration,
    created: v.created_time?.split("T")[0],
    folder: v.parent_folder?.name,
    tags: v.tags?.map((t: any) => t.name) || [],
    privacy: v.privacy?.view,
    link: v.link,
  }, null, 2);
}

async function handleGetFolderVideos(args: any): Promise<string> {
  const page = args.page || 1;
  const perPage = Math.min(args.per_page || 50, 100);

  // Get folder info
  const folderRes = await vimeoRequest(`/me/projects/${args.folder_id}?fields=name,metadata.connections.videos.total`);
  const folderName = folderRes.data.name || "Unknown";
  const totalVideos = folderRes.data.metadata?.connections?.videos?.total || 0;

  // Get videos
  const res = await vimeoRequest(`/me/projects/${args.folder_id}/videos?per_page=${perPage}&page=${page}&fields=uri,name,duration,created_time`);

  if (res.status !== 200) {
    return JSON.stringify({ error: "Failed to fetch folder videos", status: res.status });
  }

  const videos = res.data.data?.map((v: any) => ({
    id: v.uri?.split("/").pop(),
    name: v.name,
    duration: v.duration,
    created: v.created_time?.split("T")[0],
  })) || [];

  return JSON.stringify({ folder: folderName, total: totalVideos, page, per_page: perPage, videos }, null, 2);
}

async function handleMoveVideo(args: any): Promise<string> {
  const res = await vimeoRequest(`/me/projects/${args.folder_id}/items`, "POST", {
    items: [{ uri: `/videos/${args.video_id}` }],
  });

  const success = res.status === 204 || res.status === 200 || res.status === 201;
  return JSON.stringify({ success, video_id: args.video_id, folder_id: args.folder_id });
}

async function handleCreateFolder(args: any): Promise<string> {
  const res = await vimeoRequest("/me/projects", "POST", { name: args.name });

  if (res.status === 201) {
    const id = res.data.uri?.split("/").pop();
    return JSON.stringify({ success: true, id, name: args.name });
  } else if (res.status === 400 && res.data.error?.includes("already exists")) {
    return JSON.stringify({ success: false, error: "Folder already exists" });
  }

  return JSON.stringify({ success: false, error: res.data.error || "Failed to create folder" });
}

async function handleUpdateVideo(args: any): Promise<string> {
  const body: any = {};
  if (args.name) body.name = args.name;
  if (args.description) body.description = args.description;
  if (args.tags) body.tags = args.tags;

  const res = await vimeoRequest(`/videos/${args.video_id}`, "PATCH", body);
  const success = res.status === 200;

  return JSON.stringify({ success, video_id: args.video_id });
}

async function handleSearchVideos(args: any): Promise<string> {
  const page = args.page || 1;
  const perPage = Math.min(args.per_page || 25, 100);

  const res = await vimeoRequest(`/me/videos?query=${encodeURIComponent(args.query)}&per_page=${perPage}&page=${page}&fields=uri,name,duration,created_time,parent_folder`);

  if (res.status !== 200) {
    return JSON.stringify({ error: "Search failed", status: res.status });
  }

  const videos = res.data.data?.map(extractVideoMinimal) || [];
  const total = res.data.total || videos.length;

  return JSON.stringify({ query: args.query, total, page, per_page: perPage, videos }, null, 2);
}

async function handleGetStats(): Promise<string> {
  // Get video count
  const videoRes = await vimeoRequest("/me/videos?per_page=1&fields=uri");
  const totalVideos = videoRes.data.total || 0;

  // Get folder count
  const folderRes = await vimeoRequest("/me/projects?per_page=1");
  const totalFolders = folderRes.data.total || 0;

  // Get storage
  const userRes = await vimeoRequest("/me?fields=upload_quota");
  const used = userRes.data.upload_quota?.space?.used || 0;
  const max = userRes.data.upload_quota?.space?.max || 0;

  return JSON.stringify({
    total_videos: totalVideos,
    total_folders: totalFolders,
    storage_used_gb: (used / 1073741824).toFixed(2),
    storage_max_gb: (max / 1073741824).toFixed(2),
  }, null, 2);
}

// ============================================
// MCP SERVER
// ============================================

const server = new Server(
  { name: "vimeo-mcp-lite", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result: string;

    switch (name) {
      case "list_folders":
        result = await handleListFolders();
        break;
      case "list_videos":
        result = await handleListVideos(args || {});
        break;
      case "get_video":
        result = await handleGetVideo(args);
        break;
      case "get_folder_videos":
        result = await handleGetFolderVideos(args);
        break;
      case "move_video":
        result = await handleMoveVideo(args);
        break;
      case "create_folder":
        result = await handleCreateFolder(args);
        break;
      case "update_video":
        result = await handleUpdateVideo(args);
        break;
      case "search_videos":
        result = await handleSearchVideos(args);
        break;
      case "get_stats":
        result = await handleGetStats();
        break;
      default:
        result = JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    return { content: [{ type: "text", text: result }] };
  } catch (error: any) {
    return { content: [{ type: "text", text: JSON.stringify({ error: error.message }) }] };
  }
});

// Start server
const transport = new StdioServerTransport();
server.connect(transport);
console.error("vimeo-mcp-lite server running on stdio");
