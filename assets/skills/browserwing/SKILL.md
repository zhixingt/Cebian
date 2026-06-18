---
name: browserwing
description: Browser automation via BrowserWing HTTP API. Supports page navigation, element interaction (click, type, select, hover, press-key), data extraction, page analysis (snapshot, clickable-elements, input-elements), screenshot, JavaScript execution, batch operations, intelligent form filling, debug monitoring (console, network, dialog), and tab management.
metadata:
  permissions:
    - bgFetch:http://127.0.0.1:8080/*
---

# BrowserWing Executor API

## Overview

BrowserWing Executor provides comprehensive browser automation capabilities through HTTP APIs. You can control browser navigation, interact with page elements, extract data, analyze page structure, monitor network and console, and execute batch operations.

**API Base URL:** `http://127.0.0.1:8080/api/v1/executor`

**Authentication:** Use `X-BrowserWing-Key: <api-key>` header or `Authorization: Bearer <token>`

## Core Capabilities

- **Navigation:** Navigate to URLs, go back/forward, reload
- **Element Interaction:** Click, type, select, hover, press key, wait
- **Data Extraction:** Extract text, attributes, values; get page info/text/content
- **Page Analysis:** Accessibility snapshot, clickable elements, input elements
- **Advanced Operations:** Screenshot, JavaScript execution, scroll, resize, batch, form fill
- **Debug & Monitoring:** Console messages, network requests, handle dialogs, file upload, drag
- **Tab Management:** List, create, switch, close tabs

## How to use from CebianX

Use the `run_skill` tool with this skill. The `scripts/api.js` script provides a unified wrapper.

### Example: single action

```json
{
  "skill": "browserwing",
  "script": "scripts/api.js",
  "args": {
    "action": "navigate",
    "url": "https://example.com"
  },
  "tabId": 1
}
```

### Example: batch operations

```json
{
  "skill": "browserwing",
  "script": "scripts/api.js",
  "args": {
    "action": "batch",
    "operations": [
      {"type": "navigate", "params": {"url": "https://example.com"}},
      {"type": "type", "params": {"identifier": "@e1", "text": "hello"}},
      {"type": "click", "params": {"identifier": "@e2"}}
    ]
  },
  "tabId": 1
}
```

### Example: intelligent form filling

```json
{
  "skill": "browserwing",
  "script": "scripts/api.js",
  "args": {
    "action": "fillForm",
    "url": "https://example.com/form",
    "data": {
      "name": "John Doe",
      "email": "john@example.com",
      "country": "United States"
    }
  },
  "tabId": 1
}
```

## Supported Actions (via scripts/api.js)

### Navigation
| Action | Parameters | Description |
|--------|-----------|-------------|
| `navigate` | `url` | Open a URL |
| `goBack` | - | Go back in history |
| `goForward` | - | Go forward in history |
| `reload` | - | Reload current page |

### Element Interaction
| Action | Parameters | Description |
|--------|-----------|-------------|
| `snapshot` | - | Get accessibility snapshot (returns RefIDs like `@e1`) |
| `click` | `identifier` | Click element |
| `type` | `identifier`, `text` | Type text into input |
| `select` | `identifier`, `value` | Select dropdown option |
| `hover` | `identifier` | Hover over element |
| `pressKey` | `key` | Press keyboard key (e.g. Enter, Tab) |
| `wait` | `identifier`, `state`, `timeout` | Wait for element state |

### Data Extraction
| Action | Parameters | Description |
|--------|-----------|-------------|
| `extract` | `selector`, `fields`, `multiple` | Extract data from elements |
| `getText` | `identifier` | Get element text content |
| `getValue` | `identifier` | Get input value |
| `pageInfo` | - | Get page metadata (title, url, etc.) |
| `pageText` | - | Get all visible page text |
| `pageContent` | - | Get full page HTML content |

### Page Analysis
| Action | Parameters | Description |
|--------|-----------|-------------|
| `clickableElements` | - | List all clickable elements |
| `inputElements` | - | List all input elements |

### Advanced Operations
| Action | Parameters | Description |
|--------|-----------|-------------|
| `screenshot` | `fullPage` | Take screenshot |
| `evaluate` | `expression` | Execute JavaScript |
| `batch` | `operations` | Execute multiple operations |
| `fillForm` | `url`, `data` | Intelligent form filling |
| `scrollToBottom` | - | Scroll to page bottom |
| `resize` | `width`, `height` | Resize browser viewport |
| `tabs` | `action`, ... | Manage tabs (list, new, switch, close) |

### Debug & Monitoring
| Action | Parameters | Description |
|--------|-----------|-------------|
| `consoleMessages` | `clear` | Get console logs |
| `networkRequests` | `clear` | Get network requests |
| `handleDialog` | `accept`, `promptText` | Accept/dismiss dialog |
| `fileUpload` | `selector`, `filePath` | Upload file |
| `drag` | `source`, `target` | Drag and drop |
| `closePage` | - | Close current page |

### Help
| Action | Parameters | Description |
|--------|-----------|-------------|
| `help` | `command` (optional) | Discover available commands |

## Element Identification

1. **RefID (Recommended):** `@e1`, `@e2` — from snapshot, most stable
2. **CSS Selector:** `#id`, `.class`, `button[type="submit"]`
3. **XPath:** `//button[@id='login']`
4. **Text Content:** `Login`, `Submit`

## Workflow

1. **Discover:** Call `help` to see available commands
2. **Navigate:** Use `navigate` to open target page
3. **Analyze:** Call `snapshot` to get page structure and RefIDs
4. **Interact:** Use RefIDs to click, type, select
5. **Extract:** Use `extract` to get information
6. **Verify:** Call `snapshot` again to confirm state changes

## Error Handling

- If operation fails, check element identifier and try different format
- For timeout errors, increase timeout value
- If element not found, call `snapshot` again to refresh page structure
- Browser auto-starts on first operation if not running
