# vimeo-mcp-lite

Token-efficient MCP server for Vimeo API. Designed for AI assistants with minimal response payloads.

## Why This Exists

Other Vimeo MCPs return **~18KB per video** even in "minimal" mode. This MCP returns **~100 bytes per video** - a 180x reduction in token usage.

| Feature | Other MCPs | vimeo-mcp-lite |
|---------|------------|----------------|
| List 50 videos | ~900KB | ~5KB |
| Per-video payload | ~18,000 chars | ~100 chars |
| Folder operations | Limited | First-class |
| Server-side filtering | No | Yes |

## Installation

```bash
npm install -g vimeo-mcp-lite
```

Or from source:

```bash
git clone https://github.com/justmy2satoshis/vimeo-mcp-lite.git
cd vimeo-mcp-lite
npm install
npm run build
```

## Configuration

### Claude Code

Add to `~/.claude.json`:

```json
{
  "mcpServers": {
    "vimeo": {
      "command": "vimeo-mcp-lite",
      "env": {
        "VIMEO_ACCESS_TOKEN": "your_token_here"
      }
    }
  }
}
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vimeo": {
      "command": "node",
      "args": ["/path/to/vimeo-mcp-lite/dist/index.js"],
      "env": {
        "VIMEO_ACCESS_TOKEN": "your_token_here"
      }
    }
  }
}
```

## Required Scopes

Your Vimeo access token needs these scopes:
- `private` - Access private videos
- `edit` - Update video metadata
- `create` - Create folders
- `interact` - Move videos between folders

Get a token at: https://developer.vimeo.com/apps

## Available Tools

### Folder Operations

| Tool | Description | Response Size |
|------|-------------|---------------|
| `list_folders` | List all folders with video counts | ~50 bytes/folder |
| `create_folder` | Create a new folder | ~30 bytes |
| `get_folder_videos` | Get videos in a folder | ~100 bytes/video |

### Video Operations

| Tool | Description | Response Size |
|------|-------------|---------------|
| `list_videos` | List videos (paginated) | ~100 bytes/video |
| `search_videos` | Search by name | ~100 bytes/video |
| `get_video` | Get single video details | ~300 bytes |
| `move_video` | Move video to folder | ~50 bytes |
| `update_video` | Update title/description/tags | ~50 bytes |

### Account

| Tool | Description |
|------|-------------|
| `get_stats` | Get account statistics |

## Response Format

All responses are minimal JSON:

```json
// list_videos response
{
  "total": 3081,
  "page": 1,
  "per_page": 50,
  "videos": [
    {"id": "123456", "name": "Video Title", "duration": 360, "created": "2025-01-10", "folder": "Marketing"}
  ]
}

// list_folders response
{
  "total": 35,
  "folders": [
    {"id": "789", "name": "Marketing", "video_count": 150}
  ]
}
```

## Example Usage

```
User: List all my Vimeo folders
Claude: [calls list_folders]

User: Search for videos about "webinar"
Claude: [calls search_videos with query="webinar"]

User: Move video 123456 to folder 789
Claude: [calls move_video with video_id="123456", folder_id="789"]
```

## Development

```bash
# Install dependencies
npm install

# Build
npm run build

# Run in dev mode
npm run dev
```

## License

MIT
